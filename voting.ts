import { App } from '@slack/bolt';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { logError, log, logWarn } from './loger';

// Simulated storage for user votes
const votesFilePath = './votes.json';

export function runVoting() {
    dotenv.config();

    const app = new App({
        token: process.env.SLACK_BOT_TOKEN!,
        appToken: process.env.SLACK_APP_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        socketMode: true,
    });

    const votingOptions = loadVotingOptions("./ideas.json")

    function loadVotingOptions(filePath: string) {
        const fileData = fs.readFileSync(filePath, 'utf-8');
        const ideas = JSON.parse(fileData);

        return Object.values(ideas)
            .filter((idea: any) => idea.approved) // Assume `approved` exists and is a boolean
            .map((idea: any) => ({
                ideaName: idea.idea, // Assume `idea` exists and is a string
                ideaDescription: idea.explanation, // Assume `explanation` exists and is a string
            }));
    }

    function shuffleIdeas(allOptions: any[]) {
        for (let i = allOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]]; // Swap elements
        }
        return allOptions;
    }
    
    const userVotes: Record<string, string[]> = restoreVotes();

    function saveVotes(userVotes: Record<string, string[]>) {
        try {
            fs.writeFileSync(votesFilePath, JSON.stringify(userVotes, null, 2), 'utf-8');
            log('Votes successfully saved to votes.json');
        } catch (error) {
            logError('Error saving votes:', error);
        }
    }

    function restoreVotes(): Record<string, string[]> {
        try {
            if (fs.existsSync(votesFilePath)) {
                const fileData = fs.readFileSync(votesFilePath, 'utf-8');
                return JSON.parse(fileData);
            } else {
                logWarn('votes.json not found, returning an empty object.');
                return {};
            }
        } catch (error) {
            logError('Error restoring votes:', error);
            return {};
        }
    }

    app.event('app_home_opened', async ({ event, client }) => {
        try {
            const userId = event.user;
            const userSelectedValues = userVotes[userId] || [];
    
            // Map votingOptions to Slack checkbox format
            const allOptions = votingOptions.map(option => ({
                text: {
                    type: "mrkdwn",
                    text: `*${option.ideaName}*`,
                },
                description: {
                    type: "mrkdwn",
                    text: `_${option.ideaDescription}_`,
                },
                value: option.ideaName,
            }));
    
            const initialOptions = allOptions.filter(option =>
                userSelectedValues.includes(option.value)
            );
    
            // Function to chunk options
            const CHUNK_SIZE = 10;
            function chunkArray<T>(arr: T[], size: number): T[][] {
                const chunks: T[][] = [];
                for (let i = 0; i < arr.length; i += size) {
                    chunks.push(arr.slice(i, i + size));
                }
                return chunks;
            }
    
            // Chunk options into groups of 10
            const optionChunks = chunkArray(shuffleIdeas(allOptions), CHUNK_SIZE);
    
            // Create blocks for each chunk
            //@ts-ignore
            const blocks = optionChunks.flatMap((chunk, index) => {
                const accessory = {
                    type: "checkboxes",
                    action_id: `checkboxes-action`,
                    options: chunk,
                    ...(initialOptions.length > 0 && { initial_options: chunk.filter(option => userSelectedValues.includes(option.value)) }),
                };
    
                // Add a header for the first page, skip for subsequent pages
                if (index === 0) {
                    return [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: "Please select all the themes that interest you.\n_(If you think you could create a game around the theme, select it)_",
                            },
                            accessory,
                        },
                    ];
                }
    
                // For subsequent pages, use the "actions" block type without any text
                return [
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "checkboxes",
                                action_id: `checkboxes-action`,
                                options: chunk,
                                ...(initialOptions.length > 0 && { initial_options: chunk.filter(option => userSelectedValues.includes(option.value)) }),
                            },
                        ],
                    },
                ];
            });
    
            await client.views.publish({
                user_id: userId,
                view: {
                    type: "home",
                    //@ts-ignore
                    blocks,
                },
            });
        } catch (error) {
            logError('Error publishing Home Tab', error);
        }
    });
    
      
    
    app.action('checkboxes-action', async ({ ack, body, client }) => {
        await ack();

        try {
            const userId = body.user.id;
            //@ts-ignore
            const action = body.actions[0];

            const selectedValues = action.selected_options.map(option => option.value);

            // Store updated user selections
            userVotes[userId] = selectedValues;

            // Generate confirmation message
            // const checkedNames = votingOptions
            //     .filter(option => selectedValues.includes(option.ideaName))
            //     .map(option => option.ideaName)
            //     .join(', ') || 'None';

            // await client.chat.postMessage({
            //     channel: userId,
            //     text: `Your current selections are: ${checkedNames}`,
            // });

        saveVotes(userVotes)
            // log(JSON.stringify(userVotes))
        } catch (error) {
            logError('Error processing checkboxes action:', error);
        }
    });

    // Start the app
    (async () => {
        await app.start();
        log('Slack bot is running...');
    })();
}
