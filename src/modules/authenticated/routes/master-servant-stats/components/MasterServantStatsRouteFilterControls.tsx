import { GameServantConstants, GameServantRarity } from '@fgo-planner/data-core';
import { Checkbox, Icon, IconButton, ListItemText, MenuItem, MenuProps, TextField, Tooltip } from '@mui/material';
import { Box, SystemStyleObject, Theme } from '@mui/system';
import React, { ChangeEvent, ReactNode, SetStateAction, useCallback, useEffect, useState } from 'react';
import { InputFieldContainer, StyleClassPrefix as InputFieldContainerStyleClassPrefix } from '../../../../../components/input/InputFieldContainer';
import { GameServantClassSimplified, TextFieldChangeEvent } from '../../../../../types';
import { MasterServantStatsRouteTypes } from '../MasterServantStatsRouteTypes';

export type MasterServantStatsRouteFilterControlsResult = {
    groupBy: MasterServantStatsRouteTypes.GroupBy;
} & MasterServantStatsRouteTypes.FilterOptions;

type Props = {
    onFilterChange: (filter: MasterServantStatsRouteFilterControlsResult) => void;
};

const StyleClassPrefix = 'MasterServantStatsRouteFilterControls';

const StyleProps = {
    display: 'flex',
    height: 64,
    mt: 6,
    mb: -2,
    [`& .${StyleClassPrefix}-multiSelectCheckbox`]: {
        ml: -2,
        pr: 3
    },
    [`& .${InputFieldContainerStyleClassPrefix}-root`]: {
        px: 2
    }
} as SystemStyleObject<Theme>;

/**
 * Value of the 'all' option in multi-select dropdowns.
 */
// TODO Move this to a constants class.
const MultiSelectAllOption = 'All';

const SelectMenuProps: Partial<MenuProps> = {
    anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'center'
    },
    transformOrigin: {
        vertical: 'top',
        horizontal: 'center'
    }
};

const ClassFilterOptions = Object.values(GameServantClassSimplified);

const renderMultiSelectValue = (value: unknown): ReactNode => {
    const selected = value as string[];
    if (!selected.length) {
        return 'None';
    }
    if (selected[selected.length - 1] === MultiSelectAllOption) {
        return 'All';
    }
    return selected.join(', ');
};

export const MasterServantStatsRouteFilterControls = React.memo(({ onFilterChange }: Props) => {
    const [groupBy, setGroupBy] = useState<MasterServantStatsRouteTypes.GroupBy>('rarity');
    const [classFilter, setClassFilter] = useState<GameServantClassSimplified[]>([...ClassFilterOptions]);
    const [rarityFilter, setRarityFilter] = useState<GameServantRarity[]>([...GameServantConstants.RarityValues]);

    useEffect(() => {
        onFilterChange({
            groupBy,
            classes: new Set(classFilter),
            rarities: new Set(rarityFilter)
        });
    }, [onFilterChange, groupBy, classFilter, rarityFilter]);

    const handleStatsGroupByChange = useCallback((event: TextFieldChangeEvent): void => {
        const value = event.target.value as MasterServantStatsRouteTypes.GroupBy;
        setGroupBy(value);
        // Reset filters depending on the new groupBy value.
        if (value === 'rarity') {
            setClassFilter([...ClassFilterOptions]);
        } else {
            setRarityFilter([...GameServantConstants.RarityValues]);
        }
    }, []);

    // TODO Move this to a util class?
    const handleMultiSelectChange = useCallback(<T,>(
        values: string[],
        prevValues: T[],
        allValues: ReadonlyArray<T>,
        setState: (value: SetStateAction<T[]>) => void
    ): void => {

        // Index of the 'all' option value
        const allIndex = values.indexOf(MultiSelectAllOption);

        // Whether all the options were previously selected
        const prevAllSelected = prevValues.length === allValues.length;

        if (prevAllSelected) {
            if (allIndex !== -1) {
                /*
                 * If all the options were previously selected, and the 'all' option is still
                 * selected, that means one of the other options were deselected. We remove
                 * the 'all' option value from the array and set it to the state.
                 */
                values.splice(allIndex, 1);
                setState(values as any);
            } else {
                /*
                 * If all the options were previously selected, and the 'all' option is no
                 * longer selected, that means the 'all' option was deselected. The behavior
                 * for this is to deselect all the options.
                 */
                setState([]);
            }
        } else {
            if (allIndex !== -1) {
                /*
                 * If all the options were not previously selected, and the 'all' option is now
                 * selected, then add all the options to the state.
                 */
                setState([...allValues]);
            } else {
                /*
                 * If all the options were not previously selected, and the 'all' option is
                 * still not selected, then just set the values to the state.
                 */
                setState(values as any);
            }
        }
    }, []);

    const handleClassFilterChange = useCallback((event: ChangeEvent<{ value: unknown }>): void => {
        const values = event.target.value as string[];
        handleMultiSelectChange(values, classFilter, ClassFilterOptions, setClassFilter);
    }, [classFilter, handleMultiSelectChange]);

    const handleRarityFilterChange = useCallback((event: ChangeEvent<{ value: unknown }>): void => {
        const values = event.target.value as string[];
        handleMultiSelectChange(values, rarityFilter, GameServantConstants.RarityValues, setRarityFilter);
    }, [rarityFilter, handleMultiSelectChange]);

    const handleResetFilterClick = useCallback(() => {
        // Do not reset the `groupBy` value here.
        setClassFilter([...ClassFilterOptions]);
        setRarityFilter([...GameServantConstants.RarityValues]);
    }, []);

    /*
     * Render the 'group by' select.
     */
    const groupBySelect = (
        <TextField
            variant='outlined'
            color='secondary'
            select
            fullWidth
            label='Group By'
            SelectProps={{
                MenuProps: SelectMenuProps
            }}
            value={groupBy}
            onChange={handleStatsGroupByChange}
        >
            <MenuItem value='rarity' style={{ height: 54 }}>Rarity</MenuItem>
            <MenuItem value='class' style={{ height: 54 }}>Class</MenuItem>
        </TextField>
    );

    /*
     * Render the class filter select. This is only displayed when the stats are
     * grouped by rarity.
     */
    let classFilterSelect: ReactNode = null;
    if (groupBy === 'rarity') {
        const allSelected = classFilter.length === ClassFilterOptions.length;
        classFilterSelect = (
            <TextField
                variant='outlined'
                color='secondary'
                select
                fullWidth
                label='Class'
                SelectProps={{
                    multiple: true,
                    MenuProps: SelectMenuProps,
                    renderValue: renderMultiSelectValue
                }}
                value={allSelected ? [...classFilter, MultiSelectAllOption] : classFilter}
                onChange={handleClassFilterChange}
            >
                <MenuItem value={MultiSelectAllOption}>
                    <Checkbox
                        className={`${StyleClassPrefix}-multiSelectCheckbox`}
                        checked={!!classFilter.length}
                        indeterminate={!allSelected && !!classFilter.length}
                    />
                    <ListItemText primary='All' />
                </MenuItem>
                {ClassFilterOptions.map(servantClassName => (
                    <MenuItem key={servantClassName} value={servantClassName}>
                        <Checkbox
                            className={`${StyleClassPrefix}-multiSelectCheckbox`}
                            checked={classFilter.indexOf(servantClassName) !== -1}
                        />
                        <ListItemText primary={servantClassName} />
                    </MenuItem>
                ))}
            </TextField>
        );
    }

    /*
     * Render the rarity filter select. This is only displayed when the stats are
     * grouped by class.
     */
    let rarityFilterSelect: ReactNode = null;
    if (groupBy === 'class') {
        const allSelected = rarityFilter.length === GameServantConstants.RarityValues.length;
        rarityFilterSelect = (
            <TextField
                variant='outlined'
                color='secondary'
                select
                fullWidth
                label='Rarity'
                SelectProps={{
                    multiple: true,
                    MenuProps: SelectMenuProps,
                    renderValue: renderMultiSelectValue
                }}
                value={allSelected ? [...rarityFilter, MultiSelectAllOption] : rarityFilter}
                onChange={handleRarityFilterChange}
            >
                <MenuItem value={MultiSelectAllOption}>
                    <Checkbox
                        className={`${StyleClassPrefix}-multiSelectCheckbox`}
                        checked={!!rarityFilter.length}
                        indeterminate={!allSelected && !!rarityFilter.length}
                    />
                    <ListItemText primary='All' />
                </MenuItem>
                {GameServantConstants.RarityValues.map(rarity => (
                    <MenuItem key={rarity} value={rarity}>
                        <Checkbox
                            className={`${StyleClassPrefix}-multiSelectCheckbox`}
                            checked={rarityFilter.indexOf(rarity) !== -1}
                        />
                        <ListItemText primary={`${rarity} \u2605`} />
                    </MenuItem>
                ))}
            </TextField>
        );
    }

    return (
        <Box className={`${StyleClassPrefix}-root`} sx={StyleProps}>
            <InputFieldContainer width={240}>
                {groupBySelect}
            </InputFieldContainer>
            <InputFieldContainer width={240}>
                {/* Only one of the below can be non-null at any given time. */}
                {classFilterSelect}
                {rarityFilterSelect}
            </InputFieldContainer>
            <Tooltip key='reset' title='Reset filters' placement='right'>
                <div>
                    <IconButton
                        color='secondary'
                        onClick={handleResetFilterClick}
                        size='large'
                    >
                        <Icon>replay</Icon>
                    </IconButton>
                </div>
            </Tooltip>
        </Box>
    );
});
