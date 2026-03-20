import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CapabilityPack {
    name: string;
    summary: string;
    source: string;
    activation_mode: string;
    tools: string[];
    capabilities: string[];
    requires_channel: string | null;
}

interface PackCardProps {
    pack: CapabilityPack;
    policies?: Array<{ capability: string; allowed: boolean; requires_approval: boolean }>;
}

const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
    system: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
    channel: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
    mcp: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
    skill: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
};

export default function CapabilityPackCard({ pack, policies = [] }: PackCardProps) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    const sourceStyle = SOURCE_COLORS[pack.source] || SOURCE_COLORS.system;
    const sourceLabel =
        pack.source === 'system'
            ? t('enterprise.packs.sourceSystem')
            : pack.source === 'channel'
              ? t('enterprise.packs.sourceChannel')
              : pack.source === 'mcp'
                ? t('enterprise.packs.sourceMcp')
                : t('enterprise.packs.sourceSkill', pack.source);

    const isGoverned = policies.some(
        (p) =>
            pack.capabilities.includes(p.capability) &&
            (!p.allowed || p.requires_approval),
    );

    return (
        <div
            className="card"
            style={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                    {pack.name}
                </span>
                <span
                    style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: sourceStyle.bg,
                        color: sourceStyle.color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                    }}
                >
                    {sourceLabel}
                </span>
                {isGoverned && (
                    <span
                        style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: 'rgba(239,68,68,0.12)',
                            color: '#f87171',
                            letterSpacing: '0.3px',
                        }}
                    >
                        {t('enterprise.packs.restricted')}
                    </span>
                )}
                {pack.requires_channel && (
                    <span
                        style={{
                            fontSize: '10px',
                            color: 'var(--text-tertiary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                        }}
                    >
                        <span style={{ fontSize: '12px' }}>&#x1F517;</span>
                        {t('enterprise.packs.requiresChannel')}
                    </span>
                )}
            </div>

            {/* Summary */}
            <p
                style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    margin: 0,
                    lineHeight: 1.5,
                }}
            >
                {pack.summary}
            </p>

            {/* Expandable tools section */}
            {pack.tools.length > 0 && (
                <div>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            fontSize: '11px',
                            color: 'var(--text-tertiary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}
                    >
                        <span
                            style={{
                                display: 'inline-block',
                                transition: 'transform 0.15s',
                                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                fontSize: '10px',
                            }}
                        >
                            &#x25B6;
                        </span>
                        {t('enterprise.packs.tools')} ({pack.tools.length})
                    </button>
                    {expanded && (
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '4px',
                                marginTop: '6px',
                            }}
                        >
                            {pack.tools.map((tool) => (
                                <span
                                    key={tool}
                                    style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--text-secondary)',
                                        fontFamily: 'var(--font-mono)',
                                        border: '1px solid var(--border-subtle)',
                                    }}
                                >
                                    {tool}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Footer: activation mode */}
            <div
                style={{
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '6px',
                    marginTop: '2px',
                }}
            >
                {t('enterprise.packs.activation')}: {pack.activation_mode}
            </div>
        </div>
    );
}
