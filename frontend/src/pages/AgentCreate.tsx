import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi, enterpriseApi, skillApi } from '../services/api';
import ChannelConfig from '../components/ChannelConfig';

/* ── Template definitions ─────────────────────────────────────────── */

interface AgentTemplate {
    id: string;
    nameKey: string;
    icon: string;
    role: string;
    personality: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
    {
        id: 'research',
        nameKey: 'wizard.templates.research',
        icon: '\uD83D\uDD0D',
        role: '\u8C03\u7814\u5206\u6790\u3001\u4FE1\u606F\u6536\u96C6\u4E0E\u62A5\u544A\u64B0\u5199',
        personality: '\u4E25\u8C28\u3001\u6570\u636E\u9A71\u52A8',
    },
    {
        id: 'feishu-ops',
        nameKey: 'wizard.templates.feishuOps',
        icon: '\uD83D\uDCAC',
        role: '\u901A\u8FC7\u98DE\u4E66\u534F\u8C03\u56E2\u961F\u5DE5\u4F5C\u3001\u7BA1\u7406\u65E5\u7A0B\u4E0E\u6587\u6863',
        personality: '\u9AD8\u6548\u3001\u4E3B\u52A8',
    },
    {
        id: 'content',
        nameKey: 'wizard.templates.content',
        icon: '\u270D\uFE0F',
        role: '\u6587\u6848\u64B0\u5199\u3001\u5185\u5BB9\u7F16\u8F91\u4E0E\u521B\u610F\u8F93\u51FA',
        personality: '\u521B\u610F\u3001\u7EC6\u81F4',
    },
    {
        id: 'custom',
        nameKey: 'wizard.templates.custom',
        icon: '\u26A1',
        role: '',
        personality: '',
    },
];

/* ── Phase constants ──────────────────────────────────────────────── */

type Phase = 'templates' | 'identity' | 'abilities' | 'boundaries' | 'success';

export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [phase, setPhase] = useState<Phase>('templates');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const clearFieldError = (field: string) =>
        setFieldErrors((prev) => {
            const n = { ...prev };
            delete n[field];
            return n;
        });
    const [currentTenant] = useState<string | null>(() => localStorage.getItem('current_tenant_id'));
    const [createdAgentName, setCreatedAgentName] = useState('');
    const [createdAgentId, setCreatedAgentId] = useState('');

    const [form, setForm] = useState({
        name: '',
        role_description: '',
        personality: '',
        boundaries: '',
        primary_model_id: '' as string,
        skill_ids: [] as string[],
        permission_scope_type: 'company',
        permission_access_level: 'use',
        security_zone: 'standard',
        autonomy_policy: {
            read_files: 'L1',
            write_workspace_files: 'L2',
            delete_files: 'L3',
            send_feishu_message: 'L2',
            web_search: 'L1',
            execute_code: 'L2',
        } as Record<string, string>,
    });
    const [channelValues, setChannelValues] = useState<Record<string, string>>({});

    /* ── Data fetching ────────────────────────────────────────────── */

    const { data: models = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: enterpriseApi.llmModels,
    });

    const { data: globalSkills = [] } = useQuery({
        queryKey: ['global-skills'],
        queryFn: skillApi.list,
    });

    // Auto-select first enabled model
    useEffect(() => {
        if (models.length > 0 && !form.primary_model_id) {
            const firstEnabled = (models as any[]).find((m: any) => m.enabled);
            if (firstEnabled) {
                setForm((prev) => ({ ...prev, primary_model_id: firstEnabled.id }));
            }
        }
    }, [models, form.primary_model_id]);

    // Auto-select default skills
    useEffect(() => {
        if (globalSkills.length > 0) {
            const defaultIds = globalSkills.filter((s: any) => s.is_default).map((s: any) => s.id);
            if (defaultIds.length > 0) {
                setForm((prev) => ({
                    ...prev,
                    skill_ids: Array.from(new Set([...prev.skill_ids, ...defaultIds])),
                }));
            }
        }
    }, [globalSkills]);

    /* ── Template selection ────────────────────────────────────────── */

    const handleSelectTemplate = (tpl: AgentTemplate) => {
        setForm((prev) => ({
            ...prev,
            name: tpl.id !== 'custom' ? t(tpl.nameKey) : '',
            role_description: tpl.role,
            personality: tpl.personality,
        }));
        setPhase('identity');
    };

    /* ── Validation ───────────────────────────────────────────────── */

    const validateIdentity = (): boolean => {
        const errors: Record<string, string> = {};
        const name = form.name.trim();
        if (!name) {
            errors.name = t('wizard.errors.nameRequired', '\u667A\u80FD\u4F53\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A');
        } else if (name.length < 2) {
            errors.name = t('wizard.errors.nameTooShort', '\u540D\u79F0\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26');
        } else if (name.length > 100) {
            errors.name = t('wizard.errors.nameTooLong', '\u540D\u79F0\u4E0D\u80FD\u8D85\u8FC7 100 \u4E2A\u5B57\u7B26');
        }
        if (form.role_description.length > 500) {
            errors.role_description = t('wizard.errors.roleDescTooLong', '\u89D2\u8272\u63CF\u8FF0\u4E0D\u80FD\u8D85\u8FC7 500 \u4E2A\u5B57\u7B26\uFF08\u5F53\u524D {{count}} \u5B57\u7B26\uFF09').replace(
                '{{count}}',
                String(form.role_description.length),
            );
        }
        const enabledModels = (models as any[]).filter((m: any) => m.enabled);
        if (enabledModels.length > 0 && !form.primary_model_id) {
            errors.primary_model_id = t('wizard.errors.modelRequired', '\u8BF7\u9009\u62E9\u4E00\u4E2A\u4E3B\u6A21\u578B');
        }
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleNextToAbilities = () => {
        setError('');
        if (!validateIdentity()) return;
        setPhase('abilities');
    };

    const handleNextToBoundaries = () => {
        setError('');
        setPhase('boundaries');
    };

    /* ── Channel payload builder ───────────────────────────────────── */

    const buildChannelPayload = () => {
        const channels: Array<{ channel_type: string; config: Record<string, string> }> = [];
        if (channelValues.feishu_app_id && channelValues.feishu_app_secret) {
            channels.push({
                channel_type: 'feishu',
                config: {
                    app_id: channelValues.feishu_app_id,
                    app_secret: channelValues.feishu_app_secret,
                    encrypt_key: channelValues.feishu_encrypt_key || '',
                    connection_mode: channelValues.feishu_connection_mode || 'websocket',
                },
            });
        }
        if (channelValues.slack_bot_token && channelValues.slack_signing_secret) {
            channels.push({
                channel_type: 'slack',
                config: {
                    app_id: channelValues.slack_bot_token,
                    app_secret: channelValues.slack_signing_secret,
                },
            });
        }
        if (channelValues.discord_bot_token && channelValues.discord_application_id) {
            channels.push({
                channel_type: 'discord',
                config: {
                    app_id: channelValues.discord_application_id,
                    app_secret: channelValues.discord_bot_token,
                    encrypt_key: channelValues.discord_public_key || '',
                },
            });
        }
        return channels;
    };

    /* ── Submit ────────────────────────────────────────────────────── */

    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            return await agentApi.bootstrap(data);
        },
        onSuccess: async (result) => {
            const agent = result.agent;
            queryClient.invalidateQueries({ queryKey: ['agents'] });
            setCreatedAgentName(agent.name || form.name);
            setCreatedAgentId(agent.id);
            setPhase('success');
        },
        onError: (err: any) => setError(err.message),
    });

    const handleCreate = () => {
        setError('');
        createMutation.mutate({
            agent: {
                name: form.name,
                role_description: form.role_description,
                personality: form.personality,
                boundaries: form.boundaries,
                primary_model_id: form.primary_model_id || undefined,
                skill_ids: form.skill_ids,
                permission_scope_type: form.permission_scope_type,
                permission_access_level: form.permission_access_level,
                tenant_id: currentTenant || undefined,
                security_zone: form.security_zone,
                agent_class: 'internal_tenant',
                autonomy_policy: form.autonomy_policy,
            },
            channels: buildChannelPayload(),
        });
    };

    /* ── Derived values ───────────────────────────────────────────── */

    const enabledModels = useMemo(() => (models as any[]).filter((m: any) => m.enabled), [models]);

    /* ── Render: Template Gallery ─────────────────────────────────── */

    if (phase === 'templates') {
        return (
            <div>
                <div className="page-header">
                    <h1 className="page-title">{t('nav.newAgent')}</h1>
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                    {t('wizard.templates.title')}
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
                    {t('wizard.templates.subtitle')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', maxWidth: '720px' }}>
                    {AGENT_TEMPLATES.map((tpl) => (
                        <div
                            key={tpl.id}
                            className="card card-clickable"
                            onClick={() => handleSelectTemplate(tpl)}
                            style={{ padding: '20px', cursor: 'pointer', textAlign: 'center' }}
                        >
                            <div style={{ fontSize: '32px', marginBottom: '12px' }}>{tpl.icon}</div>
                            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                                {t(tpl.nameKey)}
                            </div>
                            {tpl.role && (
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                                    {tpl.role}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /* ── Render: Success Screen ───────────────────────────────────── */

    if (phase === 'success') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10003;</div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '12px' }}>
                    {t('wizard.success.title', { name: createdAgentName })}
                </h2>
                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button
                        className="btn btn-primary"
                        onClick={() => navigate(`/agents/${createdAgentId}`, { state: { openChat: true } })}
                    >
                        {t('wizard.success.startChat')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => navigate(`/agents/${createdAgentId}`)}
                    >
                        {t('wizard.success.connectChannel')}
                    </button>
                </div>
            </div>
        );
    }

    /* ── Render: Steps (identity / abilities) ─────────────────────── */

    const stepIndex = phase === 'identity' ? 0 : phase === 'abilities' ? 1 : 2;
    const stepLabels = [t('wizard.steps.identity'), t('wizard.steps.abilities'), t('wizard.steps.boundaries', 'Permissions & Channels')];

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">{t('nav.newAgent')}</h1>
            </div>

            {/* Stepper — 2 steps */}
            <div className="wizard-steps">
                {stepLabels.map((label, i) => (
                    <div key={i} style={{ display: 'contents' }}>
                        <div className={`wizard-step ${i === stepIndex ? 'active' : i < stepIndex ? 'completed' : ''}`}>
                            <div className="wizard-step-number">{i < stepIndex ? '\u2713' : i + 1}</div>
                            <span>{label}</span>
                        </div>
                        {i < stepLabels.length - 1 && <div className="wizard-connector" />}
                    </div>
                ))}
            </div>

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '640px', marginBottom: '16px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px' }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        if (phase === 'identity') setPhase('templates');
                        else if (phase === 'abilities') setPhase('identity');
                        else if (phase === 'boundaries') setPhase('abilities');
                    }}
                    disabled={createMutation.isPending}
                >
                    {phase === 'identity' ? t('common.cancel') : t('wizard.prev')}
                </button>
                {phase === 'identity' ? (
                    <button className="btn btn-primary" onClick={handleNextToAbilities}>
                        {t('wizard.next')} &rarr;
                    </button>
                ) : phase === 'abilities' ? (
                    <button className="btn btn-primary" onClick={handleNextToBoundaries}>
                        {t('wizard.next')} &rarr;
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={handleCreate} disabled={createMutation.isPending}>
                        {createMutation.isPending ? t('common.loading') : t('wizard.finish')}
                    </button>
                )}
            </div>

            {error && (
                <div style={{ background: 'var(--error-subtle)', color: 'var(--error)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ maxWidth: '640px' }}>
                {/* Step 1: Identity — "Who is this?" */}
                {phase === 'identity' && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.step1New.title')}
                        </h3>

                        {/* Name */}
                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.name')} *</label>
                            <input
                                className={`form-input${fieldErrors.name ? ' input-error' : ''}`}
                                value={form.name}
                                onChange={(e) => {
                                    setForm({ ...form, name: e.target.value });
                                    clearFieldError('name');
                                }}
                                placeholder={t('wizard.step1.namePlaceholder')}
                                autoFocus
                            />
                            {fieldErrors.name && (
                                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.name}</div>
                            )}
                        </div>

                        {/* Role */}
                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.role')} *</label>
                            <textarea
                                className={`form-textarea${fieldErrors.role_description ? ' input-error' : ''}`}
                                rows={2}
                                value={form.role_description}
                                onChange={(e) => {
                                    setForm({ ...form, role_description: e.target.value });
                                    clearFieldError('role_description');
                                }}
                                placeholder={t('wizard.roleHint')}
                            />
                            {fieldErrors.role_description && (
                                <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.role_description}</div>
                            )}
                        </div>

                        {/* Communication style — collapsible */}
                        <details style={{ marginBottom: '16px' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {t('wizard.identity.communicationStyle')}
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">{t('agent.fields.personality')}</label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.personality}
                                        onChange={(e) => setForm({ ...form, personality: e.target.value })}
                                        placeholder={t('wizard.step2.personalityPlaceholder')}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">{t('agent.fields.boundaries')}</label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={form.boundaries}
                                        onChange={(e) => setForm({ ...form, boundaries: e.target.value })}
                                        placeholder={t('wizard.step2.boundariesPlaceholder')}
                                    />
                                </div>
                            </div>
                        </details>

                        {/* AI Model — single dropdown */}
                        <div className="form-group">
                            <label className="form-label">{t('wizard.identity.aiModel')} *</label>
                            {enabledModels.length > 0 ? (
                                <>
                                    <select
                                        className={`form-input${fieldErrors.primary_model_id ? ' input-error' : ''}`}
                                        value={form.primary_model_id}
                                        onChange={(e) => {
                                            setForm({ ...form, primary_model_id: e.target.value });
                                            clearFieldError('primary_model_id');
                                        }}
                                    >
                                        <option value="">{t('wizard.identity.selectModel')}</option>
                                        {enabledModels.map((m: any) => (
                                            <option key={m.id} value={m.id}>
                                                {m.label} ({m.provider}/{m.model})
                                            </option>
                                        ))}
                                    </select>
                                    {fieldErrors.primary_model_id && (
                                        <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.primary_model_id}</div>
                                    )}
                                </>
                            ) : (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.step1.noModels')}{' '}
                                    <span style={{ color: 'var(--accent-primary)', cursor: 'pointer' }} onClick={() => navigate('/enterprise')}>
                                        {t('wizard.step1.enterpriseSettings')}
                                    </span>{' '}
                                    {t('wizard.step1.addModels')}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Abilities — "What can they do?" */}
                {phase === 'abilities' && (
                    <div>
                        <h3 style={{ marginBottom: '6px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.abilities.title')}
                        </h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {t('wizard.abilities.description')}
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {globalSkills.map((skill: any) => {
                                const isDefault = skill.is_default;
                                const isChecked = form.skill_ids.includes(skill.id);
                                return (
                                    <label
                                        key={skill.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '12px',
                                            background: isChecked ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                            border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                            borderRadius: '8px',
                                            cursor: isDefault ? 'default' : 'pointer',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            disabled={isDefault}
                                            onChange={(e) => {
                                                if (isDefault) return;
                                                if (e.target.checked) {
                                                    setForm({ ...form, skill_ids: [...form.skill_ids, skill.id] });
                                                } else {
                                                    setForm({ ...form, skill_ids: form.skill_ids.filter((id: string) => id !== skill.id) });
                                                }
                                            }}
                                        />
                                        <div style={{ fontSize: '18px' }}>{skill.icon}</div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: 500, fontSize: '13px' }}>{skill.name}</span>
                                                {isDefault && (
                                                    <span
                                                        style={{
                                                            fontSize: '10px',
                                                            padding: '1px 6px',
                                                            borderRadius: '4px',
                                                            background: 'var(--accent-primary)',
                                                            color: '#fff',
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {t('wizard.abilities.recommendedBadge')}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                {skill.description}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                            {globalSkills.length === 0 && (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.abilities.noSkills')}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {t('wizard.abilities.approvalHint')}
                        </div>
                    </div>
                )}

                {/* Step 3: Boundaries — "Permissions & Channels" */}
                {phase === 'boundaries' && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>
                            {t('wizard.steps.boundaries', '权限与渠道')}
                        </h3>

                        {/* Access scope */}
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                                {t('wizard.boundaries.accessScope', '谁可以使用')}
                            </label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[
                                    { value: 'company', label: t('wizard.boundaries.everyone', '全公司'), desc: t('wizard.boundaries.everyoneDesc', '组织内所有用户均可使用') },
                                    { value: 'user', label: t('wizard.boundaries.selfOnly', '仅自己'), desc: t('wizard.boundaries.selfOnlyDesc', '仅创建者本人可使用') },
                                ].map((scope) => (
                                    <label key={scope.value} style={{
                                        display: 'flex', alignItems: 'center', gap: '12px', padding: '14px',
                                        background: form.permission_scope_type === scope.value ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                        border: `1px solid ${form.permission_scope_type === scope.value ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                        borderRadius: '8px', cursor: 'pointer',
                                    }}>
                                        <input type="radio" name="scope" checked={form.permission_scope_type === scope.value}
                                            onChange={() => setForm({ ...form, permission_scope_type: scope.value })} />
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '13px' }}>{scope.label}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{scope.desc}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Autonomy policy */}
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                                {t('wizard.boundaries.autonomy', '操作自主性')}
                            </label>
                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                {t('wizard.boundaries.autonomyDesc', '决定数字员工在执行不同操作时的自主程度。')}
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {[
                                    { key: 'read_files', label: t('wizard.boundaries.readFiles', '读取文件') },
                                    { key: 'write_workspace_files', label: t('wizard.boundaries.writeFiles', '写入文件') },
                                    { key: 'delete_files', label: t('wizard.boundaries.deleteFiles', '删除文件') },
                                    { key: 'send_feishu_message', label: t('wizard.boundaries.sendMessage', '发送消息') },
                                    { key: 'web_search', label: t('wizard.boundaries.webSearch', '网络搜索') },
                                    { key: 'execute_code', label: t('wizard.boundaries.executeCode', '执行代码') },
                                ].map(({ key, label }) => (
                                    <div key={key} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                        border: '1px solid var(--border-default)',
                                    }}>
                                        <span style={{ fontSize: '13px' }}>{label}</span>
                                        <select
                                            style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                                            value={form.autonomy_policy[key] || 'L2'}
                                            onChange={(e) => setForm({ ...form, autonomy_policy: { ...form.autonomy_policy, [key]: e.target.value } })}
                                        >
                                            <option value="L1">{t('wizard.boundaries.l1', '自动执行')}</option>
                                            <option value="L2">{t('wizard.boundaries.l2', '执行并通知')}</option>
                                            <option value="L3">{t('wizard.boundaries.l3', '需要审批')}</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Channel connection — optional */}
                        <details style={{ marginBottom: '16px' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {t('wizard.boundaries.connectChannel', '连接通信渠道（可选）')}
                            </summary>
                            <div style={{ paddingTop: '12px' }}>
                                <ChannelConfig mode="create" values={channelValues} onChange={setChannelValues} />
                            </div>
                        </details>
                    </div>
                )}
            </div>
        </div>
    );
}
