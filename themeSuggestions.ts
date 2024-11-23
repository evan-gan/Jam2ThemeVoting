import * as dotenv from "dotenv";
import { App } from '@slack/bolt';
import { log, logError, logWarn } from './loger';
import fs from 'fs';

export async function RunThemeSuggestions() {
    dotenv.config();

    const REVIEW_CHANNEL_ID = "C0825KW0DNX"; // Set review channel ID here
    const IDEAS_FILE = "./ideas.json";

    // Load ideas JSON or initialize empty object
    const loadIdeas = (): Record<string, any> => {
        if (fs.existsSync(IDEAS_FILE)) {
            return JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf8'));
        }
        return {};
    };
    let ideas = loadIdeas();

    log("Starting theme submissions...");

    const app = new App({
        token: process.env.SLACK_BOT_TOKEN!,
        appToken: process.env.SLACK_APP_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        socketMode: true
    });

    // Send a message with a button to open the idea submission form
    const sendIdeaButtonMessage = async (channelId: string) => {
        await app.client.chat.postMessage({
            channel: channelId,
            text: "Submit a new theme idea!",
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "Click the button below to submit your theme idea."
                    }
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: "Submit Theme Idea"
                            },
                            action_id: "open_theme_form",
                            style: "primary"
                        }
                    ]
                }
            ]
        });
    };

    // Opens the theme submission form
    app.action("open_theme_form", async ({ ack, body, client }) => {
        await ack();
        if (ideas.hasOwnProperty(body.user.id)) { 
            await client.views.open({
                //@ts-ignore
                trigger_id: body.trigger_id,
                view: {
                    type: "modal",
                    // callback_id: "submit_theme_idea",
                    title: { type: "plain_text", text: "Theme Submission" },
                    blocks: [
                        {
                            "type": "section",
                            "text": {
                                "type": "plain_text",
                                "text": "You already submitted a theme. Sorry!",
                                "emoji": true
                            }
                        }
                    ],
                    // submit: { type: "plain_text", text: "Submit" }
                }
            });
        }

        await client.views.open({
            //@ts-ignore
            trigger_id: body.trigger_id,
            view: {
                type: "modal",
                callback_id: "submit_theme_idea",
                title: { type: "plain_text", text: "Theme Submission" },
                blocks: [
                    {
                        type: "input",
                        block_id: "idea_input",
                        label: { type: "plain_text", text: "Theme Idea (should be open to interpretation and only a few words)" },
                        element: {
                            type: "plain_text_input",
                            action_id: "idea"
                        }
                    },
                    {
                        type: "input",
                        block_id: "explanation_input",
                        label: { type: "plain_text", text: "Explanation (less than 100 characters, or about 20 words)" },
                        element: {
                            type: "plain_text_input",
                            action_id: "explanation",
                            // multiline: true
                        }
                    }
                ],
                submit: { type: "plain_text", text: "Submit" }
            }
        });
    });

    // Handle form submission and save it to JSON
    app.view("submit_theme_idea", async ({ ack, view, body, client }) => {
        await ack();
        const userId = body.user.id;
        const idea = view.state.values.idea_input.idea.value;
        const explanation = view.state.values.explanation_input.explanation.value;
        if ((explanation?.length ?? 0) > 140) {
            logWarn(`${body.user.name} (${body.user.id})'s explanation was too long`)
            return
        }
        ideas[userId] = { idea, explanation, approved: false, reviewer: null };
        fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideas, null, 2));

        const result = await client.chat.postMessage({
            channel: REVIEW_CHANNEL_ID,
            text: `New theme idea submitted by <@${userId}>`,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: `Theme idea submitted by <@${userId}>\n*Idea:* ${idea}\n*Explanation:* ${explanation}\n*Status:* NOT REVIEWED` } },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "approve_idea", value: userId, style: "primary" },
                        { type: "button", text: { type: "plain_text", text: "Disapprove" }, action_id: "disapprove_idea", value: userId, style: "danger" }
                    ]
                }
            ]
        });

        ideas[userId].reviewMessageTs = result.ts;
        fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideas, null, 2));

        // Notify user of approval
        await client.chat.postMessage({
            channel: userId,
            text: `Your theme idea has been submitted!`
        });
    });

    // Approve button handler
    app.action("approve_idea", async ({ ack, body, client }) => {
        await ack();
        //@ts-ignore - It works, trust me :)
        const userId = body.actions[0].value;
        const reviewerId = body.user.id;

        ideas[userId].approved = true;
        ideas[userId].reviewer = reviewerId;
        fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideas, null, 2));

        // Edit review message with approver
        await client.chat.update({
            channel: REVIEW_CHANNEL_ID,
            ts: ideas[userId].reviewMessageTs,
            text: `Idea approved by <@${reviewerId}>`,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: `Theme idea submitted by <@${userId}>\n*Idea:* ${ideas[userId].idea}\n*Explanation:* ${ideas[userId].explanation}\n*Status:* Approved by <@${reviewerId}>` } },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "Revise decision: Approve" }, action_id: "approve_idea", value: userId, style: "primary" },
                        { type: "button", text: { type: "plain_text", text: "Revise decision: Disapprove" }, action_id: "disapprove_idea", value: userId, style: "danger" }
                    ]
                }
            ]
        });

        // Notify user of approval
        await client.chat.postMessage({
            channel: userId,
            text: `Your idea was approved!\n*Idea:* ${ideas[userId].idea}\n*Explanation:* ${ideas[userId].explanation}`
        });
    });

    // Disapprove button handler
    app.action("disapprove_idea", async ({ ack, body, client }) => {
        await ack();
        //@ts-ignore - It works, trust me :)
        const userId = body.actions[0].value;
        const reviewerId = body.user.id;

        ideas[userId].approved = false;
        ideas[userId].reviewer = reviewerId;

        // Prompt for reason
        await client.views.open({
            //@ts-ignore
            trigger_id: body.trigger_id,
            view: {
                type: "modal",
                callback_id: "disapprove_reason",
                private_metadata: JSON.stringify({ userId, reviewerId }),
                title: { type: "plain_text", text: "Disapproval Reason" },
                blocks: [
                    {
                        type: "input",
                        block_id: "reason_input",
                        label: { type: "plain_text", text: "Reason for Disapproval" },
                        element: {
                            type: "plain_text_input",
                            action_id: "reason",
                            multiline: true
                        }
                    }
                ],
                submit: { type: "plain_text", text: "Submit" }
            }
        });
    });

    // Handle disapproval reason submission
    app.view("disapprove_reason", async ({ ack, view, body, client }) => {
        await ack();
        const metadata = JSON.parse(view.private_metadata);
        const userId = metadata.userId;
        const reviewerId = metadata.reviewerId;
        const reason = view.state.values.reason_input.reason.value;

        ideas[userId].disapprovalReason = reason;
        fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideas, null, 2));

        // Edit review message with disapprover and reason
        await client.chat.update({
            channel: REVIEW_CHANNEL_ID,
            ts: ideas[userId].reviewMessageTs,
            text: `Idea disapproved by <@${reviewerId}>`,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: `Theme idea submitted by <@${userId}>\n*Idea:* ${ideas[userId].idea}\n*Explanation:* ${ideas[userId].explanation}\n*Status:* Disapproved by <@${reviewerId}>\n*Reason:* ${reason}` } },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "Revise decision: Approve" }, action_id: "approve_idea", value: userId, style: "primary" },
                        { type: "button", text: { type: "plain_text", text: "Revise decision: Disapprove" }, action_id: "disapprove_idea", value: userId, style: "danger" }
                    ]
                }
            ]
        });

        // Notify user of disapproval with reason
        await client.chat.postMessage({
            channel: userId,
            text: `Your idea was disapproved.\n*Reason:* ${reason}\n\n*Idea:* ${ideas[userId].idea}\n*Explanation:* ${ideas[userId].explanation}`
        });
    });

    // Start the app
    (async () => {
        await app.start();
        log("Slack bot is running...");
        sendIdeaButtonMessage("C082JDEBP09")
    })();
}