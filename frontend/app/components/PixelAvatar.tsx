'use client';
import React, { CSSProperties } from 'react';

const AVATARS: Record<string, React.ReactNode> = {
  '1': ( // Office Worker
    <>
      <rect x="5" y="1" width="6" height="2" fill="#4A2E0A"/>
      <rect x="4" y="2" width="1" height="3" fill="#4A2E0A"/>
      <rect x="11" y="2" width="1" height="3" fill="#4A2E0A"/>
      <rect x="5" y="2" width="6" height="5" fill="#FDBCB4"/>
      <rect x="6" y="4" width="1" height="1" fill="#1A1A2E"/>
      <rect x="9" y="4" width="1" height="1" fill="#1A1A2E"/>
      <rect x="7" y="6" width="2" height="1" fill="#C8756A"/>
      <rect x="7" y="7" width="2" height="1" fill="#FDBCB4"/>
      <rect x="2" y="8" width="2" height="4" fill="#2563C4"/>
      <rect x="12" y="8" width="2" height="4" fill="#2563C4"/>
      <rect x="4" y="8" width="8" height="5" fill="#2563C4"/>
      <rect x="6" y="8" width="4" height="1" fill="#FFFFFF"/>
      <rect x="7" y="9" width="2" height="1" fill="#FFFFFF"/>
      <rect x="2" y="12" width="2" height="1" fill="#FDBCB4"/>
      <rect x="12" y="12" width="2" height="1" fill="#FDBCB4"/>
      <rect x="4" y="13" width="3" height="3" fill="#1A1A6E"/>
      <rect x="7" y="13" width="2" height="1" fill="#1A1A6E"/>
      <rect x="9" y="13" width="3" height="3" fill="#1A1A6E"/>
    </>
  ),
  '2': ( // Manager
    <>
      <rect x="5" y="2" width="6" height="1" fill="#2A1A06"/>
      <rect x="4" y="2" width="1" height="3" fill="#2A1A06"/>
      <rect x="11" y="2" width="1" height="3" fill="#2A1A06"/>
      <rect x="5" y="2" width="6" height="6" fill="#FDBCB4"/>
      <rect x="5" y="4" width="3" height="2" fill="#AACCEE" opacity="0.5"/>
      <rect x="9" y="4" width="2" height="2" fill="#AACCEE" opacity="0.5"/>
      <rect x="5" y="4" width="1" height="1" fill="#333"/>
      <rect x="7" y="4" width="1" height="1" fill="#333"/>
      <rect x="5" y="5" width="1" height="1" fill="#333"/>
      <rect x="7" y="5" width="1" height="1" fill="#333"/>
      <rect x="9" y="4" width="1" height="1" fill="#333"/>
      <rect x="11" y="4" width="1" height="1" fill="#333"/>
      <rect x="9" y="5" width="1" height="1" fill="#333"/>
      <rect x="11" y="5" width="1" height="1" fill="#333"/>
      <rect x="8" y="5" width="1" height="1" fill="#333"/>
      <rect x="7" y="7" width="2" height="1" fill="#C8756A"/>
      <rect x="7" y="8" width="2" height="1" fill="#FDBCB4"/>
      <rect x="2" y="9" width="2" height="4" fill="#3A3A4A"/>
      <rect x="12" y="9" width="2" height="4" fill="#3A3A4A"/>
      <rect x="4" y="9" width="8" height="5" fill="#3A3A4A"/>
      <rect x="6" y="9" width="4" height="1" fill="#FFFFFF"/>
      <rect x="7" y="10" width="2" height="1" fill="#FFFFFF"/>
      <rect x="8" y="9" width="1" height="4" fill="#CC3333"/>
      <rect x="6" y="9" width="1" height="3" fill="#4A4A5A"/>
      <rect x="9" y="9" width="1" height="3" fill="#4A4A5A"/>
      <rect x="2" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="12" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="4" y="14" width="3" height="2" fill="#2A2A3A"/>
      <rect x="7" y="14" width="2" height="1" fill="#2A2A3A"/>
      <rect x="9" y="14" width="3" height="2" fill="#2A2A3A"/>
    </>
  ),
  '3': ( // Tech
    <>
      <rect x="4" y="0" width="2" height="1" fill="#1A0A00"/>
      <rect x="10" y="0" width="2" height="1" fill="#1A0A00"/>
      <rect x="6" y="1" width="4" height="1" fill="#1A0A00"/>
      <rect x="4" y="1" width="8" height="3" fill="#1A0A00"/>
      <rect x="3" y="2" width="1" height="2" fill="#1A0A00"/>
      <rect x="12" y="2" width="1" height="2" fill="#1A0A00"/>
      <rect x="5" y="2" width="6" height="6" fill="#C68642"/>
      <rect x="6" y="4" width="1" height="1" fill="#1A1A1A"/>
      <rect x="9" y="4" width="1" height="1" fill="#1A1A1A"/>
      <rect x="6" y="6" width="1" height="1" fill="#8B4513"/>
      <rect x="7" y="7" width="2" height="1" fill="#8B4513"/>
      <rect x="9" y="6" width="1" height="1" fill="#8B4513"/>
      <rect x="7" y="8" width="2" height="1" fill="#C68642"/>
      <rect x="2" y="9" width="2" height="5" fill="#2D6A2D"/>
      <rect x="12" y="9" width="2" height="5" fill="#2D6A2D"/>
      <rect x="4" y="9" width="8" height="5" fill="#2D6A2D"/>
      <rect x="6" y="11" width="4" height="2" fill="#245424"/>
      <rect x="6" y="11" width="1" height="2" fill="#1E441E"/>
      <rect x="9" y="11" width="1" height="2" fill="#1E441E"/>
      <rect x="2" y="13" width="2" height="1" fill="#C68642"/>
      <rect x="12" y="13" width="2" height="1" fill="#C68642"/>
      <rect x="4" y="14" width="3" height="2" fill="#1A1A2A"/>
      <rect x="7" y="14" width="2" height="1" fill="#1A1A2A"/>
      <rect x="9" y="14" width="3" height="2" fill="#1A1A2A"/>
    </>
  ),
  '4': ( // Analyst
    <>
      <rect x="4" y="1" width="8" height="4" fill="#8B4513"/>
      <rect x="3" y="3" width="1" height="8" fill="#8B4513"/>
      <rect x="12" y="3" width="1" height="8" fill="#8B4513"/>
      <rect x="4" y="1" width="1" height="6" fill="#8B4513"/>
      <rect x="11" y="1" width="1" height="6" fill="#8B4513"/>
      <rect x="5" y="2" width="6" height="6" fill="#FDBCB4"/>
      <rect x="6" y="4" width="1" height="1" fill="#1A1A2E"/>
      <rect x="9" y="4" width="1" height="1" fill="#1A1A2E"/>
      <rect x="6" y="3" width="1" height="1" fill="#1A1A2E"/>
      <rect x="9" y="3" width="1" height="1" fill="#1A1A2E"/>
      <rect x="5" y="5" width="1" height="1" fill="#F4A0A0" opacity="0.7"/>
      <rect x="10" y="5" width="1" height="1" fill="#F4A0A0" opacity="0.7"/>
      <rect x="7" y="6" width="2" height="1" fill="#E05070"/>
      <rect x="7" y="8" width="2" height="1" fill="#FDBCB4"/>
      <rect x="2" y="9" width="2" height="4" fill="#009688"/>
      <rect x="12" y="9" width="2" height="4" fill="#009688"/>
      <rect x="4" y="9" width="8" height="5" fill="#009688"/>
      <rect x="7" y="9" width="2" height="3" fill="#00796B"/>
      <rect x="6" y="9" width="1" height="1" fill="#00796B"/>
      <rect x="9" y="9" width="1" height="1" fill="#00796B"/>
      <rect x="2" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="12" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="4" y="14" width="8" height="2" fill="#004D40"/>
    </>
  ),
  '5': ( // Operator
    <>
      <rect x="4" y="0" width="8" height="1" fill="#FFD700"/>
      <rect x="3" y="1" width="10" height="2" fill="#FFD700"/>
      <rect x="3" y="3" width="10" height="1" fill="#E6B800"/>
      <rect x="2" y="3" width="12" height="1" fill="#E6B800"/>
      <rect x="5" y="4" width="6" height="5" fill="#FDBCB4"/>
      <rect x="6" y="5" width="1" height="1" fill="#1A1A2E"/>
      <rect x="9" y="5" width="1" height="1" fill="#1A1A2E"/>
      <rect x="6" y="8" width="4" height="1" fill="#CCAAAA"/>
      <rect x="7" y="7" width="2" height="1" fill="#C8756A"/>
      <rect x="7" y="9" width="2" height="1" fill="#FDBCB4"/>
      <rect x="2" y="10" width="2" height="4" fill="#FF6600"/>
      <rect x="12" y="10" width="2" height="4" fill="#FF6600"/>
      <rect x="4" y="10" width="8" height="4" fill="#FF6600"/>
      <rect x="6" y="10" width="4" height="1" fill="#DDDDDD"/>
      <rect x="7" y="11" width="2" height="1" fill="#DDDDDD"/>
      <rect x="4" y="12" width="8" height="1" fill="#FFFF99"/>
      <rect x="2" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="12" y="13" width="2" height="1" fill="#FDBCB4"/>
      <rect x="4" y="14" width="3" height="2" fill="#444444"/>
      <rect x="7" y="14" width="2" height="1" fill="#444444"/>
      <rect x="9" y="14" width="3" height="2" fill="#444444"/>
    </>
  ),
};

interface PixelAvatarProps {
  avatarId?: string | null;
  size?: number;
  style?: CSSProperties;
}

export default function PixelAvatar({ avatarId, size = 32, style }: PixelAvatarProps) {
  const id = avatarId && AVATARS[avatarId] ? avatarId : '1';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ imageRendering: 'pixelated', display: 'block', ...style }}
    >
      {AVATARS[id]}
    </svg>
  );
}
