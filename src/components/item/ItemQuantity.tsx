

import { Immutable } from '@fgo-planner/common-core';
import { GameItem } from '@fgo-planner/data-core';
import { Box, SystemStyleObject, Theme } from '@mui/system';
import React from 'react';
import { ItemThumbnail } from './ItemThumbnail';

type Props = {
    gameItem: Immutable<GameItem>;
    quantity: number;
    size?: string | number;
};

const DefaultThumbnailSize = 42;

export const StyleClassPrefix = 'ItemQuantity';

const StyleProps = {
    display: 'flex',
    alignItems: 'center',
    [`& .${StyleClassPrefix}-quantity`]: {
        width: 24,
        mr: 2,
        textAlign: 'right'
    } as SystemStyleObject<Theme>
};

export const ItemQuantity = React.memo(({ gameItem, quantity, size }: Props) => {

    const thumbnailSize = size || DefaultThumbnailSize;

    return (
        <Box className={`${StyleClassPrefix}-root`} sx={StyleProps}>
            <div className={`${StyleClassPrefix}-quantity`}>
                {quantity}
            </div>
            <ItemThumbnail
                gameItem={gameItem}
                size={thumbnailSize}
                showBackground
            />
        </Box>
    );

});
