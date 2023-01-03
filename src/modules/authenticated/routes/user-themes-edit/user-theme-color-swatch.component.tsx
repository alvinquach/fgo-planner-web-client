import { RgbaColor } from '@fgo-planner/data-core';
import { Icon } from '@mui/material';
import { Box, SystemStyleObject, Theme } from '@mui/system';
import { colord, RgbColor } from 'colord';
import React, { MouseEventHandler } from 'react';

type Props = {
    color: Readonly<RgbaColor | RgbColor>;
    allowEditAlpha?: boolean;
    onClick?: MouseEventHandler<HTMLDivElement>
};

const Size = 64;

const StyleClassPrefix = 'UserThemeColorSwatch';

const StyleProps = {
    width: Size,
    height: Size,
    cursor: 'pointer',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'divider',
    [`& .${StyleClassPrefix}-color-picker-icon`]: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: Size,
        height: Size,
        position: 'relative',
        top: 0,
        left: 0,
        color: '#FFF',
        mixBlendMode: 'difference',
        opacity: 0,
        transition: 'opacity 100ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
        '& .MuiIcon-root': {
            fontSize: '1.75rem'
        },
        '&:hover': {
            opacity: 0.69
        }
    }
} as SystemStyleObject<Theme>;

export const UserThemeColorSwatch = React.memo(({ color, allowEditAlpha, onClick }: Props) => (
    <Box
        className={`${StyleClassPrefix}-root`}
        style={{ background: colord(color).toRgbString() }}
        sx={StyleProps}
        onClick={onClick}
    >
        <div className={`${StyleClassPrefix}-color-picker-icon`}>
            <Icon>colorize</Icon>
        </div>
    </Box>
));
