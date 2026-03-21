import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi, capabilityApi, channelApi, enterpriseApi, packApi, skillApi } from '../services/api';
import ChannelConfig from '../components/ChannelConfig';

const STEPS = ['identity', 'capabilities', 'risk', 'channel', 'review'] as const;

export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [step, setStep] = useState(0);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    // Clear field error when user edits a field
    const clearFieldError = (field: string) => setFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    // Current company (tenant) selection from layout sidebar
    const [currentTenant] = useState<string | null>(() => localStorage.getItem('current_tenant_id'));

    const [form, setForm] = useState({
        name: '',
        role_description: '',
        personality: '',
        boundaries: '',
        primary_model_id: '' as string,
        fallback_model_id: '' as string,
        permission_scope_type: 'company',
        permission_access_level: 'use',
        max_tokens_per_day: '',
        max_tokens_per_month: '',
        skill_ids: [] as string[],
        agent_class: 'internal_tenant',
        security_zone: 'standard',
    });
    const [channelValues, setChannelValues] = useState<Record<string, string>>({});

    // Fetch LLM models for step 1
    const { data: models = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: enterpriseApi.llmModels,
    });

    // Fetch global skills for step 3
    const { data: globalSkills = [] } = useQuery({
        queryKey: ['global-skills'],
        queryFn: skillApi.list,
    });
    const { data: packCatalog = [] } = useQuery({
        queryKey: ['pack-catalog-for-create'],
        queryFn: () => packApi.catalog(),
    });
    const { data: capabilityDefinitions = [] } = useQuery({
        queryKey: ['capability-definitions-for-create'],
        queryFn: () => capabilityApi.definitions(),
    });

    // Auto-select default skills
    useEffect(() => {
        if (globalSkills.length > 0) {
            const defaultIds = globalSkills.filter((s: any) => s.is_default).map((s: any) => s.id);
            if (defaultIds.length > 0) {
                setForm(prev => ({
                    ...prev,
                    skill_ids: Array.from(new Set([...prev.skill_ids, ...defaultIds]))
                }));
            }
        }
    }, [globalSkills]);

    const kernelTools = useMemo(
        () => ['read_file', 'write_file', 'edit_file', 'glob_search', 'grep_search', 'load_skill', 'set_trigger', 'send_message_to_agent', 'send_channel_file', 'tool_search'],
        [],
    );
    const selectedSkills = useMemo(
        () => globalSkills.filter((skill: any) => form.skill_ids.includes(skill.id)),
        [globalSkills, form.skill_ids],
    );
    const selectedPacks = useMemo(() => {
        const names: string[] = [];
        const seen = new Set<string>();
        const packByTool = new Map<string, string[]>();
        for (const pack of packCatalog as any[]) {
            for (const tool of pack.tools || []) {
                const existing = packByTool.get(tool) || [];
                existing.push(pack.name);
                packByTool.set(tool, existing);
            }
        }
        for (const skill of selectedSkills as any[]) {
            for (const packName of skill.declared_packs || []) {
                if (!seen.has(packName)) {
                    seen.add(packName);
                    names.push(packName);
                }
            }
            for (const toolName of skill.declared_tools || []) {
                for (const packName of packByTool.get(toolName) || []) {
                    if (!seen.has(packName)) {
                        seen.add(packName);
                        names.push(packName);
                    }
                }
            }
        }
        return names;
    }, [packCatalog, selectedSkills]);
    const starterPacks = useMemo(
        () => (packCatalog as any[]).filter((pack: any) => selectedPacks.includes(pack.name)),
        [packCatalog, selectedPacks],
    );

    const createMutation = useMutation({
        mutationFn: async (data: any) => {
            return await agentApi.create(data);
        },
        onSuccess: async (agent) => {
            queryClient.invalidateQueries({ queryKey: ['agents'] });

            // Automatically bind channels if configured in wizard
            // Feishu
            if (channelValues.feishu_app_id && channelValues.feishu_app_secret) {
                try {
                    await channelApi.create(agent.id, {
                        channel_type: 'feishu',
                        app_id: channelValues.feishu_app_id,
                        app_secret: channelValues.feishu_app_secret,
                        encrypt_key: channelValues.feishu_encrypt_key || undefined,
                        extra_config: {
                            connection_mode: channelValues.feishu_connection_mode || 'websocket'
                        }
                    });
                } catch (err) {
                    console.error('Failed to bind Feishu channel:', err);
                    setError(
                        'Failed to bind the Feishu channel. Please verify the Feishu configuration on the agent settings page and try again.'
                    );
                }
            }

            // Slack
            if (channelValues.slack_bot_token && channelValues.slack_signing_secret) {
                try {
                    await channelApi.create(agent.id, {
                        channel_type: 'slack',
                        app_id: channelValues.slack_bot_token,
                        app_secret: channelValues.slack_signing_secret,
                    });
                } catch (err) {
                    console.error('Failed to bind Slack channel:', err);
                    setError(
                        'Failed to bind the Slack channel. Please verify the Slack configuration on the agent settings page and try again.'
                    );
                }
            }

            // Discord
            if (channelValues.discord_bot_token && channelValues.discord_application_id) {
                try {
                    await channelApi.create(agent.id, {
                        channel_type: 'discord',
                        app_id: channelValues.discord_application_id,
                        app_secret: channelValues.discord_bot_token,
                        encrypt_key: channelValues.discord_public_key || undefined,
                    });
                } catch (err) {
                    console.error('Failed to bind Discord channel:', err);
                    setError(
                        'Failed to bind the Discord channel. Please verify the Discord configuration on the agent settings page and try again.'
                    );
                }
            }

            // WeCom
            if (channelValues.wecom_bot_id && channelValues.wecom_bot_secret) {
                try {
                    const connMode = channelValues.wecom_connection_mode || 'websocket';
                    await channelApi.create(agent.id, {
                        channel_type: 'wecom',
                        app_id: connMode === 'websocket' ? channelValues.wecom_bot_id : undefined,
                        app_secret: connMode === 'websocket' ? channelValues.wecom_bot_secret : undefined,
                        extra_config: {
                            connection_mode: connMode,
                            bot_id: channelValues.wecom_bot_id,
                            bot_secret: channelValues.wecom_bot_secret,
                        }
                    });
                } catch (err) {
                    console.error('Failed to bind WeCom channel:', err);
                    setError(
                        'Failed to bind the WeCom channel. Please verify the WeCom configuration on the agent settings page and try again.'
                    );
                }
            }

            navigate(`/agents/${agent.id}`);
        },
        onError: (err: any) => setError(err.message),
    });

    const validateStep0 = (): boolean => {
        const errors: Record<string, string> = {};
        const name = form.name.trim();
        if (!name) {
            errors.name = t('wizard.errors.nameRequired', '智能体名称不能为空');
        } else if (name.length < 2) {
            errors.name = t('wizard.errors.nameTooShort', '名称至少需要 2 个字符');
        } else if (name.length > 100) {
            errors.name = t('wizard.errors.nameTooLong', '名称不能超过 100 个字符');
        }
        if (form.role_description.length > 500) {
            errors.role_description = t('wizard.errors.roleDescTooLong', '角色描述不能超过 500 个字符（当前 {{count}} 字符）').replace('{{count}}', String(form.role_description.length));
        }
        if (form.max_tokens_per_day && (isNaN(Number(form.max_tokens_per_day)) || Number(form.max_tokens_per_day) <= 0)) {
            errors.max_tokens_per_day = t('wizard.errors.tokenLimitInvalid', '请输入有效的正整数');
        }
        if (form.max_tokens_per_month && (isNaN(Number(form.max_tokens_per_month)) || Number(form.max_tokens_per_month) <= 0)) {
            errors.max_tokens_per_month = t('wizard.errors.tokenLimitInvalid', '请输入有效的正整数');
        }
        const enabledModels = (models as any[]).filter((m: any) => m.enabled);
        if (enabledModels.length > 0 && !form.primary_model_id) {
            errors.primary_model_id = t('wizard.errors.modelRequired', '请选择一个主模型');
        }
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleNext = () => {
        setError('');
        if (step === 0 && !validateStep0()) return;
        setStep(step + 1);
    };

    const handleFinish = () => {
        setError('');
        if (step === 0) {
            if (!validateStep0()) return;
        }
        createMutation.mutate({
            name: form.name,
            role_description: form.role_description,
            personality: form.personality,
            boundaries: form.boundaries,
            primary_model_id: form.primary_model_id || undefined,
            fallback_model_id: form.fallback_model_id || undefined,
            permission_scope_type: form.permission_scope_type,
            max_tokens_per_day: form.max_tokens_per_day ? Number(form.max_tokens_per_day) : undefined,
            max_tokens_per_month: form.max_tokens_per_month ? Number(form.max_tokens_per_month) : undefined,
            skill_ids: form.skill_ids,
            permission_access_level: form.permission_access_level,
            tenant_id: currentTenant || undefined,
            security_zone: form.security_zone,
            agent_class: form.agent_class,
        });
    };

    const selectedModel = models.find((m: any) => m.id === form.primary_model_id);
    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">{t('nav.newAgent')}</h1>
            </div>

            {/* Stepper */}
            <div className="wizard-steps">
                {STEPS.map((s, i) => (
                    <div key={s} style={{ display: 'contents' }}>
                        <div className={`wizard-step ${i === step ? 'active' : i < step ? 'completed' : ''}`}>
                            <div className="wizard-step-number">{i < step ? '\u2713' : i + 1}</div>
                            <span>{t(`wizard.steps.${s}`)}</span>
                        </div>
                        {i < STEPS.length - 1 && <div className="wizard-connector" />}
                    </div>
                ))}
            </div>

            {/* Navigation — sticky between stepper and card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '640px', marginBottom: '16px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px' }}>
                <button className="btn btn-secondary" onClick={() => step > 0 ? setStep(step - 1) : navigate('/')}
                    disabled={createMutation.isPending}>
                    {step === 0 ? t('common.cancel') : t('wizard.prev')}
                </button>
                {step < STEPS.length - 1 ? (
                    <button className="btn btn-primary" onClick={handleNext}>
                        {t('wizard.next')} →
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={handleFinish}
                        disabled={createMutation.isPending}>
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
                {/* Step 1: Identity — merged basicInfo + personality + model */}
                {step === 0 && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>{t('wizard.step1New.title')}</h3>

                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.name')} *</label>
                            <input className={`form-input${fieldErrors.name ? ' input-error' : ''}`} value={form.name}
                                onChange={(e) => { setForm({ ...form, name: e.target.value }); clearFieldError('name'); }}
                                placeholder={t("wizard.step1.namePlaceholder")} autoFocus />
                            {fieldErrors.name && <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.name}</div>}
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.role')}</label>
                            <input className={`form-input${fieldErrors.role_description ? ' input-error' : ''}`} value={form.role_description}
                                onChange={(e) => { setForm({ ...form, role_description: e.target.value }); clearFieldError('role_description'); }}
                                placeholder={t('wizard.roleHint')} />
                            {fieldErrors.role_description && <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.role_description}</div>}
                        </div>

                        {/* Personality & Boundaries — merged from old step 2 */}
                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.personality')}</label>
                            <textarea className="form-textarea" rows={3} value={form.personality}
                                onChange={(e) => setForm({ ...form, personality: e.target.value })}
                                placeholder={t("wizard.step2.personalityPlaceholder")} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('agent.fields.boundaries')}</label>
                            <textarea className="form-textarea" rows={3} value={form.boundaries}
                                onChange={(e) => setForm({ ...form, boundaries: e.target.value })}
                                placeholder={t("wizard.step2.boundariesPlaceholder")} />
                        </div>

                        {/* Model Selection */}
                        <div className="form-group">
                            <label className="form-label">{t('wizard.step1.primaryModel')} *</label>
                            {models.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {models.filter((m: any) => m.enabled).map((m: any) => (
                                        <label key={m.id} style={{
                                            display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                                            background: form.primary_model_id === m.id ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                            border: `1px solid ${form.primary_model_id === m.id ? 'var(--accent-primary)' : fieldErrors.primary_model_id ? 'var(--error)' : 'var(--border-default)'}`,
                                            borderRadius: '8px', cursor: 'pointer',
                                        }}>
                                            <input type="radio" name="model" checked={form.primary_model_id === m.id}
                                                onChange={() => { setForm({ ...form, primary_model_id: m.id }); clearFieldError('primary_model_id'); }} />
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{m.label}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{m.provider}/{m.model}</div>
                                            </div>
                                        </label>
                                    ))}
                                    {fieldErrors.primary_model_id && <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '2px' }}>{fieldErrors.primary_model_id}</div>}
                                </div>
                            ) : (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.step1.noModels')} <span style={{ color: 'var(--accent-primary)', cursor: 'pointer' }} onClick={() => navigate('/enterprise')}>{t('wizard.step1.enterpriseSettings')}</span> {t('wizard.step1.addModels')}
                                </div>
                            )}
                        </div>

                        {/* Token limits */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div className="form-group">
                                <label className="form-label">{t('wizard.step1.dailyTokenLimit')}</label>
                                <input className={`form-input${fieldErrors.max_tokens_per_day ? ' input-error' : ''}`} type="number" value={form.max_tokens_per_day}
                                    onChange={(e) => { setForm({ ...form, max_tokens_per_day: e.target.value }); clearFieldError('max_tokens_per_day'); }}
                                    placeholder={t("wizard.step1.unlimited")} />
                                {fieldErrors.max_tokens_per_day && <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.max_tokens_per_day}</div>}
                            </div>
                            <div className="form-group">
                                <label className="form-label">{t('wizard.step1.monthlyTokenLimit')}</label>
                                <input className={`form-input${fieldErrors.max_tokens_per_month ? ' input-error' : ''}`} type="number" value={form.max_tokens_per_month}
                                    onChange={(e) => { setForm({ ...form, max_tokens_per_month: e.target.value }); clearFieldError('max_tokens_per_month'); }}
                                    placeholder={t("wizard.step1.unlimited")} />
                                {fieldErrors.max_tokens_per_month && <div style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>{fieldErrors.max_tokens_per_month}</div>}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Starter Capabilities — skills only + kernel info */}
                {step === 1 && (
                    <div>
                        <h3 style={{ marginBottom: '6px', fontWeight: 600, fontSize: '15px' }}>{t('wizard.step2New.title')}</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {t('wizard.step2New.description')}
                        </p>

                        {/* Kernel info box */}
                        <div style={{
                            padding: '12px 14px', marginBottom: '20px', borderRadius: '8px',
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                            fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6,
                        }}>
                            {t('wizard.step2New.kernelInfo')}
                            <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '10px', marginBottom: '8px' }}>
                                {t('wizard.step2New.kernelTitle')}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                                {kernelTools.map((tool) => (
                                    <span key={tool} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)' }}>
                                        {tool}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                                {t('wizard.step2New.starterPacksTitle')}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                                {t('wizard.step2New.starterPacksDescription')}
                            </div>
                            {starterPacks.length > 0 ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                                    {starterPacks.map((pack: any) => (
                                        <div key={pack.name} className="card" style={{ padding: '12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
                                                <span style={{ fontWeight: 600, fontSize: '13px' }}>{pack.name}</span>
                                                <span style={{ fontSize: '10px', color: pack.enabled ? 'var(--success)' : 'var(--text-tertiary)' }}>
                                                    {pack.enabled ? t('wizard.step2New.packEnabled') : t('wizard.step2New.packDisabled')}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{pack.summary}</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {(pack.tools || []).slice(0, 4).map((tool: string) => (
                                                    <span key={tool} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                                                        {tool}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                    {t('wizard.step2New.starterPacksEmpty')}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {globalSkills.map((skill: any) => {
                                const isDefault = skill.is_default;
                                const isChecked = form.skill_ids.includes(skill.id);
                                return (
                                    <label key={skill.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                                        background: isChecked ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                        border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                        borderRadius: '8px', cursor: isDefault ? 'default' : 'pointer',
                                        opacity: isDefault ? 0.85 : 1,
                                    }}>
                                        <input type="checkbox"
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
                                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--accent-primary)', color: '#fff', fontWeight: 500 }}>
                                                    {t('wizard.step2New.requiredBadge')}
                                                </span>
                                            )}
                                        </div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{skill.description}</div>
                                        </div>
                                    </label>);
                            })}
                            {globalSkills.length === 0 && (
                                <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                    {t('wizard.step2New.noSkills')}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {t('wizard.step2New.governedActionsHint', { count: capabilityDefinitions.length })}
                        </div>
                    </div>
                )}

                {/* Step 3: Risk & Approval */}
                {step === 2 && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>{t('wizard.step3New.title')}</h3>

                        {/* Security Zone */}
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                                {t('agent.zone.title', 'Security Zone')}
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {(['standard', 'restricted', 'public'] as const).map((zone) => (
                                    <label key={zone} style={{
                                        flex: 1, display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px',
                                        background: form.security_zone === zone ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                        border: `1px solid ${form.security_zone === zone ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                        borderRadius: '8px', cursor: 'pointer',
                                    }}>
                                        <input type="radio" name="security_zone" checked={form.security_zone === zone}
                                            onChange={() => setForm({ ...form, security_zone: zone })} style={{ marginTop: '2px' }} />
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '13px' }}>{t(`agent.zone.${zone}`, zone)}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{t(`agent.zone.${zone}_desc`, '')}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Access Scope */}
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                                {t('wizard.step4.title')}
                            </label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[
                                    { value: 'company', label: t('wizard.step4.companyWide'), desc: t('wizard.step4.companyWideDesc') },
                                    { value: 'user', label: t('wizard.step4.selfOnly'), desc: t('wizard.step4.selfOnlyDesc') },
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

                        {/* Access Level — only for company scope */}
                        {form.permission_scope_type === 'company' && (
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                                    {t('wizard.step4.accessLevel', 'Default Access Level')}
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {[
                                        { value: 'use', label: t('wizard.step4.useLevel', 'Use'), desc: t('wizard.step4.useDesc', 'Can use Task, Chat, Tools, Skills, Workspace') },
                                        { value: 'manage', label: t('wizard.step4.manageLevel', 'Manage'), desc: t('wizard.step4.manageDesc', 'Full access including Settings, Mind, Relationships') },
                                    ].map((lvl) => (
                                        <label key={lvl.value} style={{
                                            flex: 1, display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px',
                                            background: form.permission_access_level === lvl.value ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                                            border: `1px solid ${form.permission_access_level === lvl.value ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                                            borderRadius: '8px', cursor: 'pointer',
                                        }}>
                                            <input type="radio" name="access_level" checked={form.permission_access_level === lvl.value}
                                                onChange={() => setForm({ ...form, permission_access_level: lvl.value })} style={{ marginTop: '2px' }} />
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{lvl.label}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{lvl.desc}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Capability hint */}
                        <div style={{
                            padding: '12px 14px', borderRadius: '8px',
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                            fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6,
                        }}>
                            {t('wizard.step3New.capabilityHint')}
                        </div>
                    </div>
                )}

                {/* Step 4: Channel — kept as-is */}
                {step === 3 && (
                    <div>
                        <h3 style={{ marginBottom: '20px', fontWeight: 600, fontSize: '15px' }}>{t('wizard.stepChannel.title')}</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {t('wizard.stepChannel.description')}
                        </p>

                        <ChannelConfig mode="create" values={channelValues} onChange={setChannelValues} />

                        {Object.keys(channelValues).length === 0 && (
                            <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '12px' }}>
                                {t('wizard.stepChannel.skipHint')}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 5: Review */}
                {step === 4 && (
                    <div>
                        <h3 style={{ marginBottom: '6px', fontWeight: 600, fontSize: '15px' }}>{t('wizard.stepReview.title')}</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                            {t('wizard.stepReview.summary')}
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {[
                                { label: t('wizard.stepReview.agentName'), value: form.name || t('wizard.summary.unnamed') },
                                { label: t('wizard.stepReview.agentRole'), value: form.role_description || '-' },
                                { label: t('wizard.stepReview.agentModel'), value: selectedModel?.label || t('wizard.stepReview.noneSelected') },
                                { label: t('wizard.stepReview.agentSkills'), value: form.skill_ids.length > 0 ? `${form.skill_ids.length}` : t('wizard.stepReview.noneSelected') },
                                { label: t('wizard.stepReview.agentStarterPacks'), value: starterPacks.length > 0 ? `${starterPacks.length}` : t('wizard.stepReview.noneSelected') },
                                { label: t('wizard.stepReview.agentSecurityZone'), value: t(`agent.zone.${form.security_zone}`, form.security_zone) },
                                { label: t('wizard.stepReview.agentAccessScope'), value: form.permission_scope_type === 'company' ? t('wizard.step4.companyWide') : t('wizard.step4.selfOnly') },
                                ...(form.permission_scope_type === 'company' ? [{ label: t('wizard.stepReview.agentAccessLevel'), value: form.permission_access_level === 'manage' ? t('wizard.step4.manageLevel', 'Manage') : t('wizard.step4.useLevel', 'Use') }] : []),
                                { label: t('wizard.stepReview.channelsConfigured'), value: Object.keys(channelValues).length > 0 ? t('wizard.stepReview.yes') : t('wizard.stepReview.no') },
                            ].map((row, i) => (
                                <div key={i} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                    border: '1px solid var(--border-default)',
                                }}>
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{row.label}</span>
                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{row.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>

            {/* Summary sidebar */}
            {selectedModel && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '640px' }}>
                    <strong>{form.name || t('wizard.summary.unnamed')}</strong> · {t('wizard.summary.model')}: {selectedModel.label}
                    {form.max_tokens_per_day && ` · ${t('wizard.summary.dailyLimit')}: ${Number(form.max_tokens_per_day).toLocaleString()}`}
                </div>
            )}
        </div>
    );
}
