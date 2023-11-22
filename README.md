## ask
ask allows you to chat with OpenAI chatbots in a terminal without wasting the time to open a heavy browser or to switch screens. The application is lightweight and keeps one separate conversation history per process.

The script uses the newer chat API from OpenAI and is preconfigured to use the GPT-4 model (gpt-4). You can switch to "gpt-3" for cheaper tokens and better response time in the script settings.

![WhatsApp Image 2023-11-17 at 17 42 10](https://github.com/Rosbifbr/ask/assets/69912238/4126a92a-792f-4310-832a-7e4ebf65f31f)
## Installation
To use it on UNIX-based systems, all you need to do is have NodeJS installed and run 'add_to_path.sh'.

## Usage and Examples
First off, be sure to configure your API key in your script.

The operating principle is very simple. Call the program, wait for a response and answer at will.

`ask "Hi there"` - Prompts the model.

`ask` - Displays a JSON of the current conversation state.

`ask | jq '.[].content'` - Parses the conversation with jq to display only the text of the messages.

`cat some_file.c | ask "What does this code do?"` - Parses file then question passed as argument.
