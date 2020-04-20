import dotenv from 'dotenv';
dotenv.config();

import { App } from '@slack/bolt'
import { KnownBlock } from '@slack/web-api'
import { conversationsSelect, inputBlock, buildModal, section, divider } from './block-kit/block-builder';

const botToken = process.env.BOT_TOKEN;

const app = new App({
    signingSecret: process.env.SIGNING_SECRET,
    token: botToken
});

interface TriagedMessages {
    high: any[],
    medium: any[],
    low: any[]
}

function underReview(message: any) : boolean {
    if (!message.reactions) {
        return false;
    }
    let eyesFound = false;
    message.reactions.forEach((reaction: { name: string, users: [], count: number}) => {
        if (reaction.name.match('eyes')) {
            eyesFound = true;
        }
    });

    return eyesFound;
}

function messageReviewed(message: any) : boolean {
    if (!message.reactions) {
        return false;
    }
    let eyesFound = false;
    message.reactions.forEach((reaction: { name: string, users: [], count: number}) => {
        if (reaction.name.match('white_check_mark')) {
            eyesFound = true;
        }
    });

    return eyesFound;
}

function searchForTriageMessages(messages: any[]): TriagedMessages {
    const triageMessages: TriagedMessages = {
        high: [],
        medium: [],
        low: [],
    };
    messages.forEach((message: any) => {
        if (message.type === 'message' && !message.subtype && message.text && !underReview(message) && !messageReviewed(message)) {
            if (message.text.startsWith(':red_circle:')) {
                triageMessages.high.push(message);
            } else if (message.text.startsWith(':large_blue_circle:')) {
                triageMessages.medium.push(message);
            } else if (message.text.startsWith(':white_circle:')) {
                triageMessages.low.push(message);
            }
        }
    });
    return triageMessages;
}

function createTriageSectionBlocks(triageGroup: any[], groupName: string): KnownBlock[] {
    const blocks : KnownBlock[] = [];
    if (triageGroup.length > 0) {
        blocks.unshift(
            section(`*There are ${triageGroup.length} ${groupName} priority messages needing triage*`)
        );
        triageGroup.forEach((message) => {
            blocks.push(section(`${message.text}`));
        })
        blocks.push(divider());

        return blocks;
    }

    return [section(`There are no ${groupName} messages`)];
}

function buildTriageResponseBlocks(messagesAwaitingTriage: TriagedMessages): KnownBlock[] {
    if (messagesAwaitingTriage.high.length === 0 && messagesAwaitingTriage.medium.length === 0 && messagesAwaitingTriage.low.length === 0) {
        return [
            section('There are no messages awaiting triage!')
        ]
    }

    const blocks: KnownBlock[] = [];

    blocks.push(...createTriageSectionBlocks(messagesAwaitingTriage.high, 'high'));
    blocks.push(...createTriageSectionBlocks(messagesAwaitingTriage.medium, 'medium'));
    blocks.push(...createTriageSectionBlocks(messagesAwaitingTriage.low, 'low'));

    return blocks;
}

// eslint-disable-next-line @typescript-eslint/camelcase
app.shortcut({ callback_id: 'triage' }, async ({ ack, body, context }) => {
    await ack();
    app.client.views.open({
        token: context.botToken,
        // eslint-disable-next-line @typescript-eslint/camelcase
        trigger_id: body.trigger_id,
        view: {
            type: 'modal',
            // View identifier
            // eslint-disable-next-line @typescript-eslint/camelcase
            callback_id: 'channel-picker',
            title: {
                type: 'plain_text',
                text: 'Pick a channel'
            },
            blocks: [
                inputBlock('Pick a channel', 'channel-input', conversationsSelect('Pick a channel', 'channel-picker'))
            ],
            submit: {
                type: 'plain_text',
                text: 'Submit',
            }
        }
    });
});

app.view('channel-picker', async ({ ack, body, context }) => {
    await ack();
    const channelID = body.view.state.values['channel-input']['channel-picker'].selected_conversation;
    const channelHistory = await app.client.conversations.history({
        token: context.botToken,
        channel: channelID,
    }).catch(error => {
        console.log(error);
        if (error.data.error === 'not_in_channel') {
            app.client.conversations.join({
                token: context.botToken,
                channel: channelID
            }).then(() => {
                app.client.conversations.history({
                    token: context.botToken,
                    channel: channelID,
                })
            })
        }
    });

    const messages = channelHistory.messages as [];
    const sortedMessages = searchForTriageMessages(messages);

    app.client.views.open({
        token: context.botToken,
        trigger_id: body.trigger_id,
        view: buildModal(
            'Triage report',
            buildTriageResponseBlocks(sortedMessages),
            'callback'
        )
    });
});

(async (): Promise<void> => {
    // Start your app
    await app.start(process.env.PORT || 3000);
    console.log('Bolt is ready and waiting...');
})();