import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBootstrapChannels } from './agentBootstrap.ts';

test('buildBootstrapChannels derives configured channels from wizard values', () => {
    const channels = buildBootstrapChannels({
        feishu_app_id: 'cli_xxx',
        feishu_app_secret: 'secret',
        feishu_connection_mode: 'websocket',
        slack_bot_token: 'xoxb-123',
        slack_signing_secret: 'sign',
        atlassian_api_key: 'ATSTT-123',
        atlassian_cloud_id: 'cloud-1',
    });

    assert.deepEqual(channels, [
        {
            channel_type: 'slack',
            config: { bot_token: 'xoxb-123', signing_secret: 'sign' },
        },
        {
            channel_type: 'feishu',
            config: {
                channel_type: 'feishu',
                app_id: 'cli_xxx',
                app_secret: 'secret',
                extra_config: { connection_mode: 'websocket' },
            },
        },
        {
            channel_type: 'atlassian',
            config: { api_key: 'ATSTT-123', cloud_id: 'cloud-1' },
        },
    ]);
});

test('buildBootstrapChannels supports wecom websocket and webhook modes', () => {
    assert.deepEqual(
        buildBootstrapChannels({
            wecom_connection_mode: 'websocket',
            wecom_bot_id: 'bot-id',
            wecom_bot_secret: 'bot-secret',
        }),
        [
            {
                channel_type: 'wecom',
                config: { bot_id: 'bot-id', bot_secret: 'bot-secret' },
            },
        ],
    );

    assert.deepEqual(
        buildBootstrapChannels({
            wecom_connection_mode: 'webhook',
            wecom_corp_id: 'corp',
            wecom_wecom_agent_id: '10001',
            wecom_secret: 'sec',
            wecom_token: 'token',
            wecom_encoding_aes_key: 'aes',
        }),
        [
            {
                channel_type: 'wecom',
                config: {
                    corp_id: 'corp',
                    wecom_agent_id: '10001',
                    secret: 'sec',
                    token: 'token',
                    encoding_aes_key: 'aes',
                },
            },
        ],
    );
});

test('buildBootstrapChannels ignores incomplete wecom webhook config without agent id', () => {
    assert.deepEqual(
        buildBootstrapChannels({
            wecom_connection_mode: 'webhook',
            wecom_corp_id: 'corp',
            wecom_secret: 'sec',
            wecom_token: 'token',
            wecom_encoding_aes_key: 'aes',
        }),
        [],
    );
});
