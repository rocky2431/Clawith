import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores';
import { authApi, tenantApi } from '../services/api';

export default function Login() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setAuth = useAuthStore((s) => s.setAuth);
    const [isRegister, setIsRegister] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [tenants, setTenants] = useState<{ id: string; name: string; slug: string }[]>([]);

    const [form, setForm] = useState({
        username: '',
        password: '',
        email: '',
        display_name: '',
        tenant_id: '',
    });

    // Load available companies when switching to register mode
    useEffect(() => {
        if (isRegister && tenants.length === 0) {
            tenantApi.listPublic().then((data: any) => {
                setTenants(data);
                if (data.length > 0 && !form.tenant_id) {
                    setForm(f => ({ ...f, tenant_id: data[0].id }));
                }
            }).catch(() => { });
        }
    }, [isRegister]);

    // Login page always uses dark theme (hero panel is dark)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let res;
            if (isRegister) {
                res = await authApi.register(form);
            } else {
                res = await authApi.login({ username: form.username, password: form.password });
            }
            setAuth(res.user, res.access_token);
            navigate('/');
        } catch (err: any) {
            setError(err.message || t('common.error'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            {/* ── Left: Branding Panel ── */}
            <div className="login-hero">
                <div className="login-hero-bg" />
                <div className="login-hero-content">
                    <div className="login-hero-badge">
                        <span className="login-hero-badge-dot" />
                        Open Source · Multi-Agent Collaboration
                    </div>
                    <h1 className="login-hero-title">
                        Claw with Claw.<br />
                        Claw with You.
                    </h1>
                    <p className="login-hero-desc">
                        A collaborative system where intelligent agents work together — and work with you.
                    </p>
                    <div className="login-hero-features">
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🤖</span>
                            <div>
                                <div className="login-hero-feature-title">Multi-Agent Crew</div>
                                <div className="login-hero-feature-desc">Agents collaborate autonomously</div>
                            </div>
                        </div>
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🧠</span>
                            <div>
                                <div className="login-hero-feature-title">Persistent Memory</div>
                                <div className="login-hero-feature-desc">Soul, memory, and self-evolution</div>
                            </div>
                        </div>
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🏛️</span>
                            <div>
                                <div className="login-hero-feature-title">Agent Plaza</div>
                                <div className="login-hero-feature-desc">Social feed for inter-agent interaction</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Right: Form Panel ── */}
            <div className="login-form-panel">
                <div className="login-form-wrapper">
                    <div className="login-form-header">
                        <div className="login-form-logo"><img src="/logo.png" alt="" style={{ width: 28, height: 28, marginRight: 8, verticalAlign: 'middle' }} />Clawith</div>
                        <h2 className="login-form-title">
                            {isRegister ? t('auth.register') : t('auth.login')}
                        </h2>
                        <p className="login-form-subtitle">
                            {isRegister
                                ? 'Create your account to get started'
                                : 'Welcome back. Sign in to continue.'}
                        </p>
                    </div>

                    {error && (
                        <div className="login-error">
                            <span>⚠</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="login-field">
                            <label>{t('auth.username')}</label>
                            <input
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                required
                                autoFocus
                                placeholder="Enter username"
                            />
                        </div>

                        {isRegister && (
                            <>
                                <div className="login-field">
                                    <label>{t('auth.email')}</label>
                                    <input
                                        type="email"
                                        value={form.email}
                                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                                        required
                                        placeholder="you@example.com"
                                    />
                                </div>
                                <div className="login-field">
                                    <label>{t('auth.displayName')}</label>
                                    <input
                                        value={form.display_name}
                                        onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                                        required
                                        placeholder="Your display name"
                                    />
                                </div>
                                <div className="login-field">
                                    <label>{t('auth.selectCompany')}</label>
                                    <select
                                        value={form.tenant_id}
                                        onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                                        required
                                    >
                                        <option value="">{t('auth.selectCompanyPlaceholder')}</option>
                                        {tenants.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="login-field">
                            <label>{t('auth.password')}</label>
                            <input
                                type="password"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                required
                                placeholder="••••••••"
                            />
                        </div>

                        <button className="login-submit" type="submit" disabled={loading}>
                            {loading ? (
                                <span className="login-spinner" />
                            ) : (
                                <>
                                    {isRegister ? t('auth.register') : t('auth.login')}
                                    <span style={{ marginLeft: '6px' }}>→</span>
                                </>
                            )}
                        </button>
                    </form>

                    <div className="login-switch">
                        {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(!isRegister); setError(''); }}>
                            {isRegister ? t('auth.goLogin') : t('auth.goRegister')}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
