export interface BootstrapChannelInput {
    channel_type: string;
    config: Record<string, unknown>;
}

function hasValues(values: Record<string, string>, keys: string[]): boolean {
    return keys.every((key) => Boolean(values[key]?.trim()));
}

export function buildBootstrapChannels(values: Record<string, string>): BootstrapChannelInput[] {
    const channels: BootstrapChannelInput[] = [];

    if (hasValues(values, ['slack_bot_token', 'slack_signing_secret'])) {
        channels.push({
            channel_type: 'slack',
            config: {
                bot_token: values.slack_bot_token,
                signing_secret: values.slack_signing_secret,
            },
        });
    }

    if (hasValues(values, ['discord_application_id', 'discord_bot_token', 'discord_public_key'])) {
        channels.push({
            channel_type: 'discord',
            config: {
                application_id: values.discord_application_id,
                bot_token: values.discord_bot_token,
                public_key: values.discord_public_key,
            },
        });
    }

    if (hasValues(values, ['teams_app_id', 'teams_app_secret'])) {
        channels.push({
            channel_type: 'teams',
            config: {
                app_id: values.teams_app_id,
                app_secret: values.teams_app_secret,
                ...(values.teams_tenant_id?.trim() ? { tenant_id: values.teams_tenant_id } : {}),
            },
        });
    }

    if (hasValues(values, ['feishu_app_id', 'feishu_app_secret'])) {
        channels.push({
            channel_type: 'feishu',
            config: {
                channel_type: 'feishu',
                app_id: values.feishu_app_id,
                app_secret: values.feishu_app_secret,
                ...(values.feishu_encrypt_key?.trim() ? { encrypt_key: values.feishu_encrypt_key } : {}),
                extra_config: {
                    connection_mode: values.feishu_connection_mode || 'websocket',
                },
            },
        });
    }

    const wecomConnectionMode = values.wecom_connection_mode || 'websocket';
    if (wecomConnectionMode === 'websocket') {
        if (hasValues(values, ['wecom_bot_id', 'wecom_bot_secret'])) {
            channels.push({
                channel_type: 'wecom',
                config: {
                    bot_id: values.wecom_bot_id,
                    bot_secret: values.wecom_bot_secret,
                },
            });
        }
    } else if (hasValues(values, ['wecom_corp_id', 'wecom_wecom_agent_id', 'wecom_secret', 'wecom_token', 'wecom_encoding_aes_key'])) {
        channels.push({
            channel_type: 'wecom',
            config: {
                corp_id: values.wecom_corp_id,
                wecom_agent_id: values.wecom_wecom_agent_id || '',
                secret: values.wecom_secret,
                token: values.wecom_token,
                encoding_aes_key: values.wecom_encoding_aes_key,
            },
        });
    }

    if (hasValues(values, ['dingtalk_app_key', 'dingtalk_app_secret'])) {
        channels.push({
            channel_type: 'dingtalk',
            config: {
                app_key: values.dingtalk_app_key,
                app_secret: values.dingtalk_app_secret,
            },
        });
    }

    if (hasValues(values, ['atlassian_api_key'])) {
        channels.push({
            channel_type: 'atlassian',
            config: {
                api_key: values.atlassian_api_key,
                ...(values.atlassian_cloud_id?.trim() ? { cloud_id: values.atlassian_cloud_id } : {}),
            },
        });
    }

    return channels;
}
