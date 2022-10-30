import { ArrayUtils, MapUtils, Nullable, ObjectUtils, ReadonlyRecord, SetUtils } from '@fgo-planner/common-core';
import { ExistingMasterServantUpdate, GameItemConstants, ImmutableMasterAccount, ImmutableMasterServant, MasterAccountUpdate, MasterServant, MasterServantBondLevel, MasterServantUpdateUtils, MasterServantUtils, NewMasterServantUpdate } from '@fgo-planner/data-core';
import { SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useInjectable } from '../../../hooks/dependency-injection/use-injectable.hook';
import { useLoadingIndicator } from '../../../hooks/user-interface/use-loading-indicator.hook';
import { useBlockNavigation, UseBlockNavigationOptions } from '../../../hooks/utils/use-block-navigation.hook';
import { MasterAccountService } from '../../../services/data/master/master-account.service';
import { SubscribablesContainer } from '../../../utils/subscription/subscribables-container';
import { SubscriptionTopics } from '../../../utils/subscription/subscription-topics';


//#region Type definitions

export type MasterAccountDataEditHookOptions = {
    includeCostumes?: boolean;
    includeItems?: boolean;
    includeServants?: boolean;
    includeSoundtracks?: boolean;
};

/**
 * For internal use only by the hook. Keeps track of the master account data
 * that have been modified.
 */
type MasterAccountEditDirtyData = {
    bondLevels: boolean;
    costumes: boolean;
    items: Set<number>;
    qp: boolean;
    servants: Set<number>;
    /**
     * This will be `true` if the order of the servants have changed or if any
     * servants have been added or removed.
     */
    servantOrder: boolean;
    soundtracks: boolean;
};

/**
 * Contains unmodified master data, slightly restructured for more efficient
 * comparison against current edit data to determine what has been modified.
 */
type MasterAccountEditReferenceData = {
    bondLevels: ReadonlyRecord<number, MasterServantBondLevel>;
    costumes: ReadonlySet<number>;
    items: ReadonlyRecord<number, number>;
    lastServantInstanceId: number;
    qp: number;
    /**
     * Use a `Map` for this to maintain order of insertion.
     */
    servants: ReadonlyMap<number, ImmutableMasterServant>;
    soundtracks: ReadonlySet<number>;
};

type MasterAccountEditData = {
    bondLevels: ReadonlyRecord<number, MasterServantBondLevel>;
    costumes: ReadonlySet<number>;
    items: ReadonlyRecord<number, number>;
    /**
     * This value will always be kept up-to-date during servant add and delete
     * operations.
     */
    lastServantInstanceId: number;
    qp: number;
    /**
     * Any edits to a servant (including bond levels and unlocked costumes) will
     * result in a new array to be instantiated for this field. In addition, the
     * servants that were edited (tracked by `instanceId`) will also be
     * reconstructed.
     */
    servants: ReadonlyArray<ImmutableMasterServant>;
    soundtracks: ReadonlySet<number>;
};

type IdNumbers = ReadonlyArray<number> | ReadonlySet<number>;

type MasterAccountUpdateFunctions = {
    updateCostumes: (costumeIds: IdNumbers) => void;
    updateItem: (itemId: number, action: SetStateAction<number>) => void;
    updateQp: (action: SetStateAction<number>) => void;
    /**
     * Add a single servant using the given `NewMasterServantUpdate` object.
     * 
     * Calls the `addServants` function internally. 
     */
    addServant: (servantData: NewMasterServantUpdate) => void;
    /**
     * Batch add servants. Each added servant will be instantiated using the given
     * `NewMasterServantUpdate` object.
     */
    addServants: (servantIds: IdNumbers, servantData: NewMasterServantUpdate) => void;
    /**
     * Updates the servants with the corresponding `instanceIds` using the given
     * `ExistingMasterServantUpdate` object.
     */
    updateServants: (instanceIds: IdNumbers, update: ExistingMasterServantUpdate) => void;
    /**
     * Updates the servant ordering based on an array of `instanceId` values.
     * Assumes that the array contains a corresponding `instanceId` value for each
     * servant. Missing `instanceId` values will result in the corresponding servant
     * being removed.
     */
    updateServantOrder: (instanceIds: ReadonlyArray<number>) => void;
    /**
     * Deletes the servants with the corresponding `instanceIds`.
     */
    deleteServants: (instanceIds: IdNumbers) => void;
    updateSoundtracks: (soundtrackIds: IdNumbers) => void;
    revertChanges: () => void;
    persistChanges: () => Promise<void>;
};

/* eslint-disable max-len */

type MasterAccountDataEditHookCommon = {
    masterAccountId?: string;
    isDataDirty: boolean;
};

type MasterAccountDataEditHookData = MasterAccountDataEditHookCommon & {
    masterAccountEditData: MasterAccountEditData;
} & MasterAccountUpdateFunctions;

type MasterAccountDataEditHookDataCostumesSubset = MasterAccountDataEditHookCommon & {
    masterAccountEditData: Pick<MasterAccountEditData, 'costumes'>;
} & Pick<MasterAccountUpdateFunctions, 'updateCostumes' | 'revertChanges' | 'persistChanges'>;

type MasterAccountDataEditHookDataItemsSubset = MasterAccountDataEditHookCommon & {
    masterAccountEditData: Pick<MasterAccountEditData, 'items' | 'qp'>;
} & Pick<MasterAccountUpdateFunctions, 'updateItem' | 'updateQp' | 'revertChanges' | 'persistChanges'>;

type MasterAccountDataEditHookDataServantsSubset = MasterAccountDataEditHookCommon & {
    masterAccountEditData: Pick<MasterAccountEditData, 'bondLevels' | 'servants'>;
} & Pick<MasterAccountUpdateFunctions, 'addServant' | 'addServants' | 'updateServants' | 'updateServantOrder' | 'deleteServants' | 'revertChanges' | 'persistChanges'>;

type MasterAccountDataEditHookDataSoundtracksSubset = MasterAccountDataEditHookCommon & {
    masterAccountEditData: Pick<MasterAccountEditData, 'soundtracks'>;
} & Pick<MasterAccountUpdateFunctions, 'updateSoundtracks' | 'revertChanges' | 'persistChanges'>;

/* eslint-enable max-len */

//#endregion


//#region Constants

const BlockNavigationPrompt = 'There are unsaved changes. Are you sure you want to discard all changes and leave the page?';

const BlockNavigationConfirmButtonText = 'Discard';

const BlockNavigationHookOptions: UseBlockNavigationOptions = {
    confirmButtonLabel: BlockNavigationConfirmButtonText,
    prompt: BlockNavigationPrompt
};

//#endregion


//#region Internal helper/utility functions

const toArray = (idNumbers: IdNumbers): ReadonlyArray<number> => {
    if (Array.isArray(idNumbers)) {
        return idNumbers;
    }
    return [...idNumbers];
};

const toSet = (idNumbers: IdNumbers): ReadonlySet<number> => {
    if (idNumbers instanceof Set) {
        return idNumbers;
    }
    return new Set(idNumbers);
};

const getUpdatedValue = <T extends number | string | object>(action: SetStateAction<T>, previousValue: T): T => {
    if (typeof action === 'function') {
        return action(previousValue);
    }
    return action;
};

const getDefaultMasterAccountEditData = (): MasterAccountEditData => ({
    bondLevels: {},
    costumes: SetUtils.emptySet(),
    lastServantInstanceId: 0,
    items: {},
    qp: 0,
    servants: [],
    soundtracks: SetUtils.emptySet()
});

const cloneMasterAccountDataForEdit = (
    masterAccount: Nullable<ImmutableMasterAccount>,
    options: MasterAccountDataEditHookOptions
): MasterAccountEditData => {
    const result = getDefaultMasterAccountEditData();
    if (!masterAccount) {
        return result;
    }
    if (options.includeCostumes) {
        result.costumes = new Set(masterAccount.costumes);
    }
    if (options.includeItems) {
        result.items = { ...masterAccount.resources.items };
        result.qp = masterAccount.resources.qp;
    }
    if (options.includeServants) {
        result.bondLevels = { ...masterAccount.bondLevels };
        result.servants = masterAccount.servants.map(MasterServantUtils.clone);
        result.lastServantInstanceId = masterAccount.lastServantInstanceId;
    }
    if (options.includeSoundtracks) {
        result.soundtracks = new Set(masterAccount.soundtracks);
    }
    return result;
};

const getDefaultMasterAccountReferenceData = (): MasterAccountEditReferenceData => ({
    bondLevels: {},
    costumes: SetUtils.emptySet(),
    items: {},
    lastServantInstanceId: 0,
    qp: 0,
    servants: MapUtils.emptyMap(),
    soundtracks: SetUtils.emptySet()
});

const cloneMasterAccountDataForReference = (
    masterAccount: Nullable<ImmutableMasterAccount>,
    options: MasterAccountDataEditHookOptions
): Readonly<MasterAccountEditReferenceData> => {
    const result = getDefaultMasterAccountReferenceData();
    if (!masterAccount) {
        return result;
    }
    if (options.includeCostumes) {
        result.costumes = new Set(masterAccount.costumes);
    }
    if (options.includeItems) {
        result.items = { ...masterAccount.resources.items };
        result.qp = masterAccount.resources.qp;
    }
    if (options.includeServants) {
        result.bondLevels = masterAccount.bondLevels;
        result.servants = ArrayUtils.mapArrayToMap(
            masterAccount.servants,
            MasterServantUtils.getInstanceId,
            MasterServantUtils.clone
        );
        result.lastServantInstanceId = masterAccount.lastServantInstanceId;
    }
    if (options.includeSoundtracks) {
        result.soundtracks = new Set(masterAccount.soundtracks);
    }
    return result;
};

const getDefaultMasterAccountEditDirtyData = (): MasterAccountEditDirtyData => ({
    bondLevels: false,
    costumes: false,
    items: new Set(),
    qp: false,
    servants: new Set(),
    servantOrder: false,
    soundtracks: false
});

const hasDirtyData = (dirtyData: MasterAccountEditDirtyData): boolean => (
    !!(
        dirtyData.bondLevels ||
        dirtyData.costumes ||
        dirtyData.items.size ||
        dirtyData.qp ||
        dirtyData.servants.size ||
        dirtyData.servantOrder ||
        dirtyData.soundtracks
    )
);

const isServantsChanged = (
    reference: ImmutableMasterServant | undefined,
    servant: ImmutableMasterServant
): boolean => {
    if (!reference) {
        return true;
    }
    return !MasterServantUtils.isEqual(reference, servant);
};

const isServantsOrderChanged = (
    reference: ReadonlyMap<number, ImmutableMasterServant>,
    servants: Array<ImmutableMasterServant>
): boolean => {
    if (reference.size !== servants.length) {
        return true;
    }
    const referenceInstanceIds = reference.keys();
    let index = 0; 
    for (const referenceInstanceId of referenceInstanceIds) {
        if (referenceInstanceId !== servants[index++].instanceId) {
            return true;
        }
    }
    return false;
};

//#endregion


//#region Hook function

/**
 * For costumes route.
 */
export function useMasterAccountDataEditHook(
    options: MasterAccountDataEditHookOptions & {
        includeCostumes: true;
        includeItems?: false;
        includeServants?: false;
        includeSoundtracks?: false;
    }
): MasterAccountDataEditHookDataCostumesSubset;
/**
 * For items route.
 */
export function useMasterAccountDataEditHook(
    options: MasterAccountDataEditHookOptions & {
        includeCostumes?: false;
        includeItems: true;
        includeServants?: false;
        includeSoundtracks?: false;
    }
): MasterAccountDataEditHookDataItemsSubset;
/**
 * For servants route.
 */
export function useMasterAccountDataEditHook(
    options: MasterAccountDataEditHookOptions & {
        includeCostumes: true;
        includeItems?: false;
        includeServants: true;
        includeSoundtracks?: false;
    }
): MasterAccountDataEditHookDataCostumesSubset & MasterAccountDataEditHookDataServantsSubset;
/**
 * For soundtracks route.
 */
export function useMasterAccountDataEditHook(
    options: MasterAccountDataEditHookOptions & {
        includeCostumes?: false;
        includeItems?: false;
        includeServants?: false;
        includeSoundtracks: true;
    }
): MasterAccountDataEditHookDataSoundtracksSubset;
/**
 *
 */
export function useMasterAccountDataEditHook(
    options?: MasterAccountDataEditHookOptions
): MasterAccountDataEditHookData;

export function useMasterAccountDataEditHook(
    {
        includeCostumes,
        includeItems,
        includeServants,
        includeSoundtracks
    }: MasterAccountDataEditHookOptions = {}
): MasterAccountDataEditHookData {

    const { invokeLoadingIndicator, resetLoadingIndicator } = useLoadingIndicator();

    const masterAccountService = useInjectable(MasterAccountService);

    /**
     * The original master account data.
     */
    const [masterAccount, setMasterAccount] = useState<Nullable<ImmutableMasterAccount>>();

    /**
     * The transformed copy of the master account data for editing.
     */
    const [editData, setEditData] = useState<MasterAccountEditData>(getDefaultMasterAccountEditData);

    /**
     * Another transformed copy of the master account data, for use as a reference
     * in determining whether data has been changed. This set of data will not be
     * modified.
     */
    const [referenceData, setReferenceData] = useState<Readonly<MasterAccountEditReferenceData>>(getDefaultMasterAccountReferenceData);

    /**
     * Tracks touched/dirty data.
     */
    const [dirtyData, setDirtyData] = useState<MasterAccountEditDirtyData>(getDefaultMasterAccountEditDirtyData);

    /**
     * Whether the tracked data is dirty.
     */
    const isDataDirty = hasDirtyData(dirtyData);

    /**
     * Prevent user from navigating away if data is dirty.
     */
    useBlockNavigation(isDataDirty, BlockNavigationHookOptions);

    /**
     * Reconstruct the include options in a new object using `useMemo` so that it
     * doesn't inadvertently trigger recomputation of hooks even if the options
     * haven't changed.
     */
    const includeOptions = useMemo((): MasterAccountDataEditHookOptions => ({
        includeCostumes,
        includeItems,
        includeServants,
        includeSoundtracks
    }), [includeCostumes, includeItems, includeServants, includeSoundtracks]);

    /**
     * Master account change subscription.
     */
    useEffect(() => {
        const onCurrentMasterAccountChangeSubscription = SubscribablesContainer
            .get(SubscriptionTopics.User.CurrentMasterAccountChange)
            .subscribe(masterAccount => {
                const editData = cloneMasterAccountDataForEdit(masterAccount, includeOptions);
                const referenceData = cloneMasterAccountDataForReference(masterAccount, includeOptions);
                setEditData(editData);
                setReferenceData(referenceData);
                setDirtyData(getDefaultMasterAccountEditDirtyData());
                setMasterAccount(masterAccount);
            });

        return () => onCurrentMasterAccountChangeSubscription.unsubscribe();
    }, [includeOptions]);

    /**
     * Master account available changes subscription.
     */
    useEffect(() => {
        const onMasterAccountChangesAvailableSubscription = SubscribablesContainer
            .get(SubscriptionTopics.User.MasterAccountChangesAvailable)
            .subscribe(masterAccountChanges => {
                // TODO Implement this
            });

        return () => onMasterAccountChangesAvailableSubscription.unsubscribe();
    }, [includeOptions]);


    //#region Local create, update, delete functions

    const updateCostumes = useCallback((costumeIds: IdNumbers): void => {
        if (!includeCostumes) {
            return;
        }
        /**
         * Construct a new `Set` here instead of using `toSet` to remove the possibility
         * the passed `costumeIds` (if it is a `Set`) from being modified externally.
         */
        editData.costumes = new Set(costumeIds);
        const isDirty = !SetUtils.isEqual(editData.costumes, referenceData.costumes);
        setDirtyData(dirtyData => ({
            ...dirtyData,
            costumes: isDirty
        }));
    }, [editData, referenceData.costumes, includeCostumes]);

    const updateQp = useCallback((action: SetStateAction<number>): void => {
        if (!includeItems) {
            return;
        }
        const amount = getUpdatedValue(action, editData.qp);
        if (editData.qp === amount) {
            return;
        }
        editData.qp = amount;
        const isDirty = amount !== referenceData.qp;
        setDirtyData(dirtyData => ({
            ...dirtyData,
            qp: isDirty
        }));
    }, [editData, referenceData.qp, includeItems]);

    const updateItem = useCallback((itemId: number, action: SetStateAction<number>): void => {
        if (!includeItems) {
            return;
        }
        if (itemId === GameItemConstants.QpItemId) {
            updateQp(action);
            return;
        }
        let currentQuantity = editData.items[itemId];
        /**
         * If the user data doesn't have an entry for the item yet, then it will be
         * added with an initial value of zero.
         *
         * Note that this is only added to the edit data; the user will still have to
         * save the changes to persist the new entry.
         *
         * Also note that if the quantity is being updated to zero, the it will not be
         * considered a change, and the data will not be marked as dirty from the
         * update.
         */
        if (currentQuantity === undefined) {
            editData.items = {
                ...editData.items,
                [itemId]: currentQuantity = 0
            };
        }
        const quantity = getUpdatedValue(action, currentQuantity);
        if (currentQuantity === quantity) {
            return;
        }
        editData.items = {
            ...editData.items,
            [itemId]: quantity
        };
        const isDirty = quantity !== (referenceData.items[itemId] || 0);
        setDirtyData(dirtyData => {
            const dirtyItems = dirtyData.items;
            if (isDirty) {
                dirtyItems.add(itemId);
            } else {
                dirtyItems.delete(itemId);
            }
            return { ...dirtyData };
        });
    }, [editData, referenceData.items, includeItems, updateQp]);

    const addServants = useCallback((servantIds: IdNumbers, servantData: NewMasterServantUpdate): void => {
        if (!includeServants) {
            return;
        }
        const {
            servants: currentServants,
            bondLevels: currentBondLevels,
            costumes: currentCostumes
        } = editData;

        let lastServantInstanceId = editData.lastServantInstanceId;
        /**
         * New object for the bond level data. A new object is constructed for this to
         * conform with the hook specifications.
         */
        const bondLevels = { ...currentBondLevels };
        /**
         * New object for the unlocked costumes data. A new set is constructed for
         * this to conform with the hook specifications.
         */
        const costumes = new Set(currentCostumes);
        /**
         * Construct new instance of a `MasterServant` object for each `servantId` and
         * add to an array.
         */
        /** */
        const newServants = toArray(servantIds).map(servantId => {
            const newServant = MasterServantUtils.create(++lastServantInstanceId);
            MasterServantUpdateUtils.applyToMasterServant(servantData, newServant, bondLevels, costumes);
            newServant.gameId = servantId;

            return newServant;
        });
        /**
         * Updated servants array. A new array is constructed for this to conform
         * with the hook specifications.
         */
        const servants = [...currentServants, ...newServants];

        editData.servants = servants;
        editData.lastServantInstanceId = lastServantInstanceId;
        editData.bondLevels = bondLevels;
        editData.costumes = costumes;

        const isBondLevelsDirty = !ObjectUtils.isShallowEquals(referenceData.bondLevels, bondLevels);
        const isCostumesDirty = !SetUtils.isEqual(referenceData.costumes, costumes);
        setDirtyData(dirtyData => {
            const dirtyServants = dirtyData.servants;
            for (const { instanceId } of newServants) {
                dirtyServants.add(instanceId);
            }
            return {
                ...dirtyData,
                servantOrder: true,
                bondLevels: isBondLevelsDirty,
                costumes: isCostumesDirty
            };
        });
    }, [editData, includeServants, referenceData]);

    const addServant = useCallback((servantData: NewMasterServantUpdate): void => {
        addServants([servantData.gameId], servantData);
    }, [addServants]);

    const updateServants = useCallback((instanceIds: IdNumbers, update: ExistingMasterServantUpdate): void => {
        if (!includeServants) {
            return;
        }
        const {
            servants: currentServants,
            bondLevels: currentBondLevels,
            costumes: currentCostumes
        } = editData;

        const instanceIdSet = toSet(instanceIds);

        /**
         * New array for the servants data. A new array is constructed for this to
         * conform with the hook specifications.
         */
        const servants = [];
        /**
         * New object for the bond level data. A new object is constructed for this to
         * conform with the hook specifications.
         */
        const bondLevels = { ...currentBondLevels };
        /**
         * New object for the unlocked costumes data. A new set is constructed for
         * this to conform with the hook specifications.
         */
        const costumes = new Set(currentCostumes);
        /**
         * Keeps track of the dirty states of the updated servants.
         */
        const isDirties: Record<number, boolean> = {};

        for (const servant of currentServants) {
            const {instanceId} = servant;
            /**
             * If the servant is not an update target, then just push to new array and
             * continue.
             */
            if (!instanceIdSet.has(instanceId)) {
                servants.push(servant);
                continue;
            }
            /**
             * Apply the edit to the target servant. The target servant object is
             * re-constructed to conform with the hook specifications.
             */
            /** */
            const targetServant = MasterServantUtils.clone(servant);
            MasterServantUpdateUtils.applyToMasterServant(update, targetServant, bondLevels, costumes);

            const referenceServant = referenceData.servants.get(instanceId);
            const isDirty = isServantsChanged(referenceServant, targetServant);
            isDirties[instanceId] = isDirty;

            servants.push(targetServant);
        }

        editData.servants = servants;
        editData.bondLevels = bondLevels;
        editData.costumes = costumes;

        const isBondLevelsDirty = !ObjectUtils.isShallowEquals(referenceData.bondLevels, bondLevels);
        const isCostumesDirty = !SetUtils.isEqual(referenceData.costumes, costumes);
        setDirtyData(dirtyData => {
            const dirtyServants = dirtyData.servants;
            for (const [key, isDirty] of Object.entries(isDirties)) {
                const instanceId = Number(key);
                if (isDirty) {
                    dirtyServants.add(instanceId);
                } else {
                    dirtyServants.delete(instanceId);
                }
            }
            return {
                ...dirtyData,
                bondLevels: isBondLevelsDirty,
                costumes: isCostumesDirty
            };
        });
    }, [editData, includeServants, referenceData]);

    const updateServantOrder = useCallback((instanceIds: ReadonlyArray<number>): void => {
        if (!includeServants) {
            return;
        }
        const { servants: currentServants } = editData;

        /**
         * New array for the servants data. A new array is constructed for this to
         * conform with the hook specifications.
         */
        const servants = [];

        /**
         * TODO This is an n^2 operation, may need some optimizations if servant list
         * gets too big.
         */
        for (const instanceId of instanceIds) {
            const index = currentServants.findIndex(servant => servant.instanceId === instanceId);
            if (index !== -1) {
                servants.push(currentServants[index]);
            }
        }

        editData.servants = servants;

        const isOrderDirty = isServantsOrderChanged(referenceData.servants, servants);
        setDirtyData(dirtyData => ({
            ...dirtyData,
            servantOrder: isOrderDirty
        }));
    }, [editData, referenceData.servants, includeServants]);

    const deleteServants = useCallback((instanceIds: IdNumbers): void => {
        if (!includeServants) {
            return;
        }
        const { servants: currentServants } = editData;

        const instanceIdSet = toSet(instanceIds);

        /**
         * Updated servants array. A new array is constructed for this to conform with
         * the hook specifications.
         */
        const servants = currentServants.filter(({ instanceId }) => !instanceIdSet.has(instanceId));

        /**
         * If the last servant in terms of `instanceId` was deleted during this
         * operation, but was also added during the same edit session (not yet
         * persisted), then the it should not count towards the updated
         * `lastServantInstanceId` value.
         *
         * If this is the case, we decrement the updated `lastServantInstanceId` value
         * until it is no longer of a servant that was deleted during this operation, or
         * if it no longer greater than the reference value (the updated value should
         * never be less than the reference value).
         */
        /** */
        let lastServantInstanceId = editData.lastServantInstanceId;
        while (lastServantInstanceId > referenceData.lastServantInstanceId) {
            if (!instanceIdSet.has(lastServantInstanceId)) {
                break;
            }
            lastServantInstanceId--;
        }
            
        // TODO Also remove bond/costume data if the last instance of the servant is removed.
        
        editData.servants = servants;
        editData.lastServantInstanceId = lastServantInstanceId;

        const referenceServants = referenceData.servants;
        const isOrderDirty = isServantsOrderChanged(referenceServants, servants);
        setDirtyData(dirtyData => {
            const dirtyServants = dirtyData.servants;
            for (const instanceId of instanceIds) {
                /**
                 * If the reference data doesn't contain a servant with this `instanceId`, that
                 * means it was newly added. In this case, removing the servant should also
                 * reset its dirty state.
                 */
                if (!referenceServants.has(instanceId)) {
                    dirtyServants.delete(instanceId);
                } else {
                    dirtyServants.add(instanceId);
                }
            }
            return {
                ...dirtyData,
                servantOrder: isOrderDirty
            };
        });
    }, [editData, referenceData, includeServants]);

    const updateSoundtracks = useCallback((soundtrackIds: IdNumbers): void => {
        if (!includeSoundtracks) {
            return;
        }
        /**
         * Construct a new `Set` here instead of using `toSet` to remove the possibility
         * the passed `soundtrackIds` (if it is a `Set`) from being modified externally.
         */
        editData.soundtracks = new Set(soundtrackIds);
        const isDirty = !SetUtils.isEqual(editData.soundtracks, referenceData.soundtracks);
        setDirtyData(dirtyData => ({
            ...dirtyData,
            soundtracks: isDirty
        }));
    }, [editData, referenceData.soundtracks, includeSoundtracks]);

    const revertChanges = useCallback((): void => {
        const editData = cloneMasterAccountDataForEdit(masterAccount, includeOptions);
        setEditData(editData);
        setDirtyData(getDefaultMasterAccountEditDirtyData());
    }, [includeOptions, masterAccount]);

    //#endregion


    //#region Back-end API functions

    const persistChanges = useCallback(async (): Promise<void> => {
        if (!masterAccount || (!includeItems && !includeServants && !includeCostumes && !includeSoundtracks)) {
            return;
        }
        invokeLoadingIndicator();
        const update: MasterAccountUpdate = {
            _id: masterAccount._id
        };
        /**
         * Unfortunately, partial update is only supported at the root level, so if only
         * one nested data point is update, the entire root level object has to be
         * included. For example, if only the `qp` value was update, the rest of the
         * `resources` object will still have to be included in the update.
         */
        if (includeItems && (dirtyData.items.size || dirtyData.qp)) {
            update.resources = {
                ...masterAccount.resources,
                items: {
                    ...editData.items
                },
                qp: editData.qp
            };
        }
        if (includeServants) {
            if (dirtyData.servants.size || dirtyData.servantOrder) {
                update.servants = [
                    ...(editData.servants as Array<MasterServant>)
                ];
                update.lastServantInstanceId = editData.lastServantInstanceId;
            }
            if (dirtyData.bondLevels) {
                update.bondLevels = {
                    ...editData.bondLevels
                };
            }
        }
        if (includeCostumes && dirtyData.costumes) {
            update.costumes = [
                ...editData.costumes
            ];
        }
        if (includeSoundtracks && dirtyData.soundtracks) {
            update.soundtracks = [
                ...editData.soundtracks
            ];
        }
        try {
            await masterAccountService.updateAccount(update);
        } finally {
            resetLoadingIndicator();
        }
    }, [
        editData,
        dirtyData,
        includeCostumes,
        includeItems,
        includeServants,
        includeSoundtracks,
        invokeLoadingIndicator,
        masterAccount,
        masterAccountService,
        resetLoadingIndicator
    ]);

    //#endregion

    return {
        masterAccountId: masterAccount?._id,
        isDataDirty,
        masterAccountEditData: editData,
        updateCostumes,
        updateItem,
        updateQp,
        addServant,
        addServants,
        updateServants,
        updateServantOrder,
        deleteServants,
        updateSoundtracks,
        revertChanges,
        persistChanges
    };

}

//#endregion
