import { ImmutableBasicMasterAccount } from '@fgo-planner/data-core';
import { Theme } from '@mui/material';
import { Box, SystemStyleObject, Theme as SystemTheme } from '@mui/system';
import React, { ReactNode } from 'react';
import { BasicMasterAccounts } from '../../../../../types';
import { MasterAccountColumnProperties, MasterAccountListVisibleColumns } from './master-account-list-columns';
import { MasterAccountListHeader } from './master-account-list-header.component';
import { MasterAccountListRow, StyleClassPrefix as MasterAccountListRowStyleClassPrefix } from './master-account-list-row.component';

type Props = {
    masterAccountList: BasicMasterAccounts;
    visibleColumns: Readonly<MasterAccountListVisibleColumns>;
};

export const StyleClassPrefix = 'MasterAccountList';

const StyleProps = (theme: SystemTheme) => {

    const {
        breakpoints,
        palette
    } = theme as Theme;

    return {
        backgroundColor: palette.background.paper,
        flex: 1,
        height: '100%',
        overflow: 'auto',
        [`& .${StyleClassPrefix}-list-container`]: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 'fit-content',
            [`& .${MasterAccountListRowStyleClassPrefix}-root`]: {
                height: 52,
                px: 4,
                display: 'flex',
                alignItems: 'center',
                fontSize: '0.875rem',
                '>div': {
                    boxSizing: 'border-box',
                    px: 2,
                    textAlign: 'center'
                },
                [`& .${MasterAccountListRowStyleClassPrefix}-name`]: {
                    width: MasterAccountColumnProperties.name.width,
                    textAlign: 'left',
                    fontWeight: 500,
                    '& a': {
                        color: palette.primary.main,
                        textDecoration: 'none'
                    },
                    [breakpoints.down('sm')]: {
                        flex: 1,
                        width: 'initial !important',
                        px: 0
                    }
                },
                [`& .${MasterAccountListRowStyleClassPrefix}-friend-id`]: {
                    width: MasterAccountColumnProperties.friendId.width,
                },
                [`& .${MasterAccountListRowStyleClassPrefix}-created`]: {
                    width: MasterAccountColumnProperties.created.width,
                },
                [`& .${MasterAccountListRowStyleClassPrefix}-modified`]: {
                    width: MasterAccountColumnProperties.modified.width,
                },
            },
            [breakpoints.down('sm')]: {
                minWidth: 0
            }
        }
    } as SystemStyleObject<SystemTheme>;
};

export const MasterAccountList = React.memo((props: Props) => {

    const {
        masterAccountList,
        visibleColumns
    } = props;

    const renderAccountRow = (account: ImmutableBasicMasterAccount, index: number): ReactNode => {
        return (
            <MasterAccountListRow
                key={account._id}
                index={index}
                account={account}
                visibleColumns={visibleColumns}
            />
        );
    };

    return (
        <Box className={`${StyleClassPrefix}-root`} sx={StyleProps}>
            <div className={`${StyleClassPrefix}-list-container`}>
                <MasterAccountListHeader visibleColumns={visibleColumns} />
                {masterAccountList.map(renderAccountRow)}
            </div>
        </Box>
    );

});
