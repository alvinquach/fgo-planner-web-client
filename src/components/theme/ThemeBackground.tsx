import { Box, SystemStyleObject, Theme } from '@mui/system';
import React, { CSSProperties, useMemo } from 'react';

type Props = {
    blur?: number;
    imageUrl?: string;
};

const StyleClassPrefix = 'ThemeBackground';

const StyleProps = {
    position: 'fixed',
    zIndex: -9999,
    overflow: 'hidden',
    [`& .${StyleClassPrefix}-background`]: {
        width: '100vw',
        height: '100vh',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
    } 
} as SystemStyleObject<Theme>;

export const ThemeBackground = React.memo((props: Props) => {

    const { imageUrl, blur } = props;

    const backgroundStyle = useMemo(() => {
        const style: CSSProperties = {};
        if (imageUrl) {
            style.backgroundImage = `url('${imageUrl}')`;
        };
        if (blur) {
            style.backdropFilter = `blur(${blur}px)`;
        }
        return style;
    }, [imageUrl, blur]);

    return (
        <Box className={`${StyleClassPrefix}-root`} sx={StyleProps}>
            {imageUrl && <div className={`${StyleClassPrefix}-background`} style={backgroundStyle} />}
        </Box>
    );

});
