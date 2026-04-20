'use client';
import React from 'react';
import PixelAvatar from './PixelAvatar';

const AVATAR_LABELS: Record<string, string> = {
  '1': 'Office Worker',
  '2': 'Manager',
  '3': 'Tech',
  '4': 'Analyst',
  '5': 'Operator',
};

interface AvatarPickerProps {
  value: string | null | undefined;
  onChange: (id: string) => void;
  classic?: boolean;
}

export default function AvatarPicker({ value, onChange, classic }: AvatarPickerProps) {
  const selected = value || '1';

  return (
    <div style={{ display: 'flex', gap: classic ? 4 : 8, flexWrap: 'wrap' }}>
      {(['1', '2', '3', '4', '5'] as const).map(id => {
        const isSelected = selected === id;
        return (
          <button
            key={id}
            type="button"
            title={AVATAR_LABELS[id]}
            onClick={() => onChange(id)}
            style={classic ? {
              width: 40, height: 40,
              padding: 3,
              background: isSelected ? '#c8d8f0' : '#e0dcd4',
              border: isSelected ? '2px solid #0a246a' : '2px solid #aaa',
              borderColor: isSelected ? '#0a246a #00184a #00184a #0a246a' : '#fff #aaa #aaa #fff',
              boxShadow: isSelected ? 'inset 1px 1px 0 #3a6ea8' : undefined,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            } : {
              width: 44, height: 44,
              padding: 4,
              background: isSelected ? '#e8f0fe' : '#f8f9fa',
              border: isSelected ? '2px solid #0d6efd' : '2px solid #dee2e6',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <PixelAvatar avatarId={id} size={28} />
          </button>
        );
      })}
    </div>
  );
}
