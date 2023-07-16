import { Nullable } from '@fgo-planner/common-core';
import { MasterAccount, UpdateMasterAccount } from '@fgo-planner/data-core';
import { Injectable } from '../../../decorators/dependency-injection/Injectable.decorator';
import { BasicMasterAccounts, UserTokenPayload } from '../../../types';
import { LockableUIFeature } from '../../../types/dto/LockableUIFeature.enum';
import { HttpUtils as Http } from '../../../utils/HttpUtils';
import { StorageKeys } from '../../../utils/storage/StorageKeys';
import { StorageUtils } from '../../../utils/storage/StorageUtils';
import { SubscribablesContainer } from '../../../utils/subscription/SubscribablesContainer';
import { SubscriptionTopics } from '../../../utils/subscription/SubscriptionTopics';
import { DataService } from '../DataService';

@Injectable
export class MasterAccountService extends DataService {

    private _currentMasterAccount: Nullable<MasterAccount>;

    /**
     * List of master accounts for the currently logged in user. The elements in
     * the list do not contain the entire master account data; only the _id, name,
     * and friendId fields are present.
     */
    private _masterAccountList: Nullable<BasicMasterAccounts>;

    private get _onCurrentMasterAccountChange() {
        return SubscribablesContainer.get(SubscriptionTopics.User.CurrentMasterAccountChange);
    }

    private get _onMasterAccountListChange() {
        return SubscribablesContainer.get(SubscriptionTopics.User.MasterAccountListChange);
    }

    constructor() {
        super(`${process.env.REACT_APP_REST_ENDPOINT}/user/master-account`);

        /**
         * Updates the active master account ID in local storage every time the app
         * instance is focused.
         */
        window.addEventListener('focus', () => {
            this._writeCurrentAccountToStorage(true, false);
        });

        /**
         * Set timeout before subscribing to let the dependencies inject first.
         *
         * This class is meant to last the lifetime of the application; no need to
         * unsubscribe from subscriptions.
         */
        setTimeout(() => {
            SubscribablesContainer
                .get(SubscriptionTopics.User.CurrentUserChange)
                .subscribe(userInfo => void this._handleCurrentUserChange(userInfo));
        });
    }

    async addAccount(masterAccount: Partial<MasterAccount>): Promise<MasterAccount> {
        const lockId = this._userInterfaceService.requestLock(LockableUIFeature.LoadingIndicator);
        let account: MasterAccount;
        try {
            account = await Http.put<MasterAccount>(`${this._BaseUrl}`, masterAccount);
            await this._updateMasterAccountList(); // Reload account list
        } finally {
            this._userInterfaceService.releaseLock(LockableUIFeature.LoadingIndicator, lockId);
        }
        this._autoSelectAccount();
        return account;
    }

    async getAccountsForCurrentUser(): Promise<BasicMasterAccounts> {
        /**
         * We do not want to invoke loading indicator here since this will periodically
         * be called by the `FixedIntervalMasterAccountChangeListener` in the
         * background.
         */
        return Http.get<BasicMasterAccounts>(`${this._BaseUrl}/current-user`);
    }

    async getAccount(id: string): Promise<MasterAccount> {
        const promise = Http.get<MasterAccount>(`${this._BaseUrl}/${id}`);
        return this._fetchWithLoadingIndicator(promise);
    }

    async updateAccount(masterAccount: UpdateMasterAccount): Promise<MasterAccount> {
        const lockId = this._userInterfaceService.requestLock(LockableUIFeature.LoadingIndicator);
        let updated: MasterAccount;
        try {
            updated = await Http.post<MasterAccount>(`${this._BaseUrl}`, masterAccount);
            await this._updateMasterAccountList(); // Reload account list
        } finally {
            this._userInterfaceService.releaseLock(LockableUIFeature.LoadingIndicator, lockId);
        }
        this._onCurrentMasterAccountChange.next(this._currentMasterAccount = updated);
        return updated;
    }

    async deleteAccount(id: string): Promise<boolean> {
        const lockId = this._userInterfaceService.requestLock(LockableUIFeature.LoadingIndicator);
        let deleted: boolean;
        try {
            deleted = await Http.delete<boolean>(`${this._BaseUrl}/${id}`);
            await this._updateMasterAccountList(); // Reload account list
        } finally {
            this._userInterfaceService.releaseLock(LockableUIFeature.LoadingIndicator, lockId);
        }
        this._autoSelectAccount();
        return deleted;
    }

    /**
     * Sets the currently selected account. If the provided account ID is empty,
     * then the selected account will be set to null.
     */
    async selectAccount(accountId: Nullable<string>): Promise<Nullable<MasterAccount>> {
        if (!accountId) {
            this._onCurrentMasterAccountChange.next(this._currentMasterAccount = null);
            this._writeCurrentAccountToStorage(true, true);
            return null;
        }
        if (this._currentMasterAccount?._id === accountId) {
            return this._currentMasterAccount;
        }
        // TODO Ensure that the selected account is in the accounts list.
        let account: Nullable<MasterAccount>;
        try {
            await this._updateMasterAccountList(); // Reload account list
            account = await this.getAccount(accountId);
            this._onCurrentMasterAccountChange.next(this._currentMasterAccount = account);
            this._writeCurrentAccountToStorage(true, true);
        } catch (e) {
            console.error(e);
            account = null;
        }
        return account;
    }

    async reloadCurrentAccount(): Promise<Nullable<MasterAccount>> {
        const accountId = this._currentMasterAccount?._id;
        if (!accountId) {
            return null;
        }
        let account: Nullable<MasterAccount>;
        try {
            account = await this.getAccount(accountId);
            await this._updateMasterAccountList(); // Reload account list
            this._onCurrentMasterAccountChange.next(this._currentMasterAccount = account);
        } catch (e) {
            console.error(e);
            account = null;
        }
        return account;
    }

    /**
     * Auto-selects a master account from the master account list if the currently
     * selected account is either null or not present in the master account list.
     * If the account list is not empty, then the first account in the list is
     * selected. Otherwise, the currently selected account will be set to null.
     */
    private _autoSelectAccount(): void {
        /**
         * If there are no accounts present, then set the current account to null.
         */
        if (!this._masterAccountList?.length) {
            this.selectAccount(null);
            return;
        }

        /**
         * If an account was already selected, and it is present in the account list,
         * then don't do anything.
         */
        /** */
        let currentMasterAccountId: Nullable<string> = this._currentMasterAccount?._id;
        if (currentMasterAccountId && this._masterAccountListContainsId(currentMasterAccountId)) {
            return;
        }

        /**
         * If there was an account ID in storage, and it is present in the account
         * list, then select it.
         */
        currentMasterAccountId = this._readCurrentAccountFromStorage();
        if (currentMasterAccountId && this._masterAccountListContainsId(currentMasterAccountId)) {
            this.selectAccount(currentMasterAccountId);
            return;
        }

        /**
         * Default to the first account in the list.
         */
        this.selectAccount(this._masterAccountList[0]._id);
    }

    /**
     * Helper method to check if an account ID exists in the list of accounts.
     */
    private _masterAccountListContainsId(accountId: string): boolean {
        if (!this._masterAccountList?.length) {
            return false;
        }
        return !!this._masterAccountList.find(account => account._id === accountId);
    }

    /**
     * Helper method for retrieving the account list for the current user and
     * pushing it to the subject.
     */
    private async _updateMasterAccountList(): Promise<void> {
        this._masterAccountList = await this.getAccountsForCurrentUser();
        this._onMasterAccountListChange.next(this._masterAccountList);
    }

    private async _handleCurrentUserChange(userInfo: Nullable<UserTokenPayload>): Promise<void> {
        if (!userInfo) {
            this._onCurrentMasterAccountChange.next(this._currentMasterAccount = null);
            this._onMasterAccountListChange.next(this._masterAccountList = null);
            return;
        }
        const lockId = this._userInterfaceService.requestLock(LockableUIFeature.LoadingIndicator);
        try {
            await this._updateMasterAccountList();
        } catch (e: any) {
            console.error(e);
            return;
        } finally {
            this._userInterfaceService.releaseLock(LockableUIFeature.LoadingIndicator, lockId);
        }
        this._autoSelectAccount();
    }

    /**
     * Reads the current account ID from storage. Attempts to read from session
     * storage first, and falls back to local storage if not available. Returns
     * `null` if not found in either storage scopes.
     *
     * Also writes the ID to session storage if it was present in local storage but
     * not session storage.
     */
    private _readCurrentAccountFromStorage(): string | null {
        let result = StorageUtils.getItemAsString(StorageKeys.User.ActiveMasterAccountId);
        if (result) {
            return result;
        }
        result = StorageUtils.getItemAsString(StorageKeys.User.LastMasterAccountId);
        if (result) {
            this._writeCurrentAccountToStorage(false, true);
        }
        return result;
    }

    /**
     * Writes the current account ID to storage.
     * 
     * @param local Whether to write the ID to local storage.
     * 
     * @param session Whether to write the ID to session storage.
     */
    private _writeCurrentAccountToStorage(local: boolean, session: boolean): void {
        const accountId = this._currentMasterAccount?._id;
        if (local) {
            StorageUtils.setItem(StorageKeys.User.LastMasterAccountId, accountId);
        }
        if (session) {
            StorageUtils.setItem(StorageKeys.User.ActiveMasterAccountId, accountId);
        }
    }

}
