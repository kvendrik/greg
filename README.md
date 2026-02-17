First we need to get all the services set up by creating an `.env` file with some keys:

```
# To pull context from Notion when building the memory using `bun run memory:create`
NOTION_API_KEY=XXXX

# If you want to use the WhatsApp client using `bun run clients:whatsapp`
TWILIO_ACCOUNT_SECRET=XXXX
TWILIO_ACCOUNT_SID=XXXX

# ID of the only sender allowed to send messages to the bot
TELEGRAM_SENDER_ID=XXX
TELEGRAM_BOT_TOKEN=XXX
```

We need to build up the agents initial context. This is done using:

```
bun run memory:create
```

Start the agent itself. This is a server that continuenly listens for requests and streams back the response. It uses Ollama and GPT-OSS as the LLM to answer prompts.

```
bun run agent
```

Now we decide how we're going to interact with the agent. The simplest option is using the CLI:

```
bun run clients:cli "<prompt>"
```

Example:

```
bun run clients:cli "How are you today?"
```

Something a bit more advanced is to use Whatsapp to interact with the agent:

```
bun run clients:whatsapp
```

This will start a server that Twilio can send incoming messages to. The server will run locally but Twilio needs a public URL. You can make your local server available publically by using `devtunnel host -p 3000 --allow-anonymous`. When you run `bun run clients:whatsapp` you will get the URL to give to Twilio. It includes a secret that you should never share. It's to ensure others can’t connect to your agent. Combine the given secret and URL you got from `devtunnel` and use that as the incoming messages webhook URL on [Twilio’s Whatsapp Learn page](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn). Connect to the Whatsapp chat using Twilio's instructions and try it out!
