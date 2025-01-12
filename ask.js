#!/usr/bin/node

// Javascript terminal LLM caller 
// Developed by Rodrigo Ourique
// MIT license
const https = require('https')
const fs = require('fs')
const os = require('os')
const readline = require('readline')
const { spawn, execSync } = require('child_process');

//Settings
const API_KEY = ""
const EDITOR = process.env.EDITOR || 'more'
const TRANSCRIPT_FOLDER = '/tmp'
const TRANSCRIPT_NAME = 'gpt_transcript-'
const TRANSCRIPT_PATH = `${TRANSCRIPT_FOLDER}/${TRANSCRIPT_NAME}${process.ppid}`

//Only for vision APIs. Must return clipboard buffer. Command written with KDE in mind but should work on other DEs running on top of Xserver
var CLIPBOARD_COMMAND // Not initialized yet
const CLIPBOARD_COMMAND_XORG = 'xclip -selection clipboard -t image/png -o'
const CLIPBOARD_COMMAND_WAYLAND = 'wl-paste'
const CLIPBOARD_COMMAND_UNSUPPORTED = 'UNSUPPORTED'
const OS_IDENTIFIER = 'ps -A' // Simple effective way to know what's going on. TODO can error in busybox implementation

//Detect OS and clipboard capabilities
//Configure for MacOS accordingly
const os_out = execSync(OS_IDENTIFIER).toString()
if (/Xorg/i.test(os_out)) CLIPBOARD_COMMAND = CLIPBOARD_COMMAND_XORG
else if (/wayland/i.test(os_out)) CLIPBOARD_COMMAND = CLIPBOARD_COMMAND_WAYLAND
else CLIPBOARD_COMMAND = CLIPBOARD_COMMAND_UNSUPPORTED

//Model parameters
const MODEL = "o1-mini" //Suggested models: gpt-4-vision-preview, gpt-4-1106-preview, gpt-4, gpt-3.5-turbo-16k
const HOST = "api.openai.com"
const ENDPOINT = "/v1/chat/completions"
const MAX_TOKENS = 2048
const TEMPERATURE = 0.6
const VISION_DETAIL = 'high' //high,low

//Colors
const ACCENT_COLOR = "\u001b[30m\u001b[42m";
const RESET = "\u001b[0m";

//Globals
var input = process.argv.slice(2).join(' ')
var conversation_state = {}
var answer
const HELP_TEXT = "Usage: ask [options] [text]\n\nOptions:\n-i: Push image from clipboard into pipeline\n-o: Manage ongoing conversations\n-c: Clear current conversation\n-l: Get last message\n-h: Show this help\n\n"

const init = async () => {
  if (API_KEY == "") throw ("Missing API key! Add one to the script and try again.")

  if (fs.existsSync(TRANSCRIPT_PATH)) {
    conversation_state = JSON.parse(fs.readFileSync(TRANSCRIPT_PATH, 'utf-8'))
  }
  else {
    conversation_state = {
      'model': MODEL,
      "messages": [
        {
          'role': MODEL.includes('o1-') ? 'user' : 'system',
          'content': 'You are ChatConcise, a very advanced LLM designed for experienced users. As ChatConcise you oblige to adhere to the following directives UNLESS overriden by the user:\nBe concise, proactive, helpful and efficient. Do not say anything more than what needed, but also, DON\'T BE LAZY. Provide ONLY code when an implementation is needed. DO NOT USE MARKDOWN.'
        }
      ],
    }
  }

  //Exclusive options and behaviours.
  if (testOption('o') && process.argv.length < 4) { await manageOngoingConvos() }
  else if (testOption('c') && process.argv.length < 4) { await clearCurrentConvo() }
  else if (testOption('h') && process.argv.length < 4) {
    console.log(HELP_TEXT)
    process.exit()
  }
  else if (testOption('l') && process.argv.length < 4) {
    let last = conversation_state['messages'].length - 1
    console.log(JSON.stringify(conversation_state['messages'][last].content))
    process.exit()
  }
  //Normal operation mode from here

  //Composable options
  if (testOption('i')) addImageToPipeline() //ONLY WORKS WITH IMAGE MODELS OBVIOUSLY

  //Perform convo request or fallback to default
  if (input) performRequest()
  else showHistory()
}

const testOption = (option) => {
  if (process.argv[2] && process.argv[2][0] == '-') return process.argv[2].includes(option)
  else return null
}

const addImageToPipeline = () => {
  if (CLIPBOARD_COMMAND == CLIPBOARD_COMMAND_UNSUPPORTED) {
    throw new Error('Unsupported OS/DE combination. Only Xorg and Wayland are supported.')
  }

  //Remove program options -i
  let argv = [...process.argv]
  argv.splice(0, 3)
  input = argv.join(' ')

  let imageBuffer = execSync(CLIPBOARD_COMMAND)
  imageBuffer = Buffer.from(imageBuffer).toString('base64')

  //Last, update input to match current vision API spec
  const user_text = input
  input = [
    {
      'type': 'text',
      'text': user_text,
    },
    {
      'type': 'image_url',
      'image_url': {
        'url': 'data:image/png;base64,' + imageBuffer,
        'detail': VISION_DETAIL,
      }
    }
  ]
}

const horizontalLine = (char = '▃', length = process.stdout.columns) => char.repeat(length);
const showHistory = () => {
  const tmp_path = os.tmpdir() + '/ask_hist'
  fs.writeFileSync(
    tmp_path,
    conversation_state['messages'].map(e =>
      `\n\n${horizontalLine()}` +
      `▍${e.role} ▐\n` +
      `${horizontalLine('▀')}\n` +
      `${e.content[0].text || e.content}`
    ).join('')
  )

  execSync([EDITOR, tmp_path].join(' '), { stdio: 'inherit' })
  fs.unlinkSync(tmp_path)
  process.exit()
}

//Chat functions.
const processResponse = (data) => {
  try {
    answer = data.choices[0]
    console.log(answer['message']['content'])

    conversation_state['messages'].push(answer['message'])
    fs.writeFileSync(TRANSCRIPT_PATH, JSON.stringify(conversation_state))
  }

  catch (e) {
    console.error('Error processing API return. Full response ahead:\n' +
      JSON.stringify(data, null, 2) +
      "Full error:" + e
    )
  }

  process.exit()
}


const readNextKeyCommand = async () => {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) =>
    process.stdin.on('data', key => {
      if (key == '\u001B\u005B\u0041') resolve('up')
      //else if (key == '\u001B\u005B\u0043') resolve('right')
      else if (key == '\u001B\u005B\u0042') resolve('down');
      //else if (key == '\u001B\u005B\u0044') resolve('left')
      else if (key == '\u000D') resolve('enter')
      else if (key == '\u0003') {
        process.exit()
      }
      else resolve(key)
    })
  )
}

const manageOngoingConvos = async () => {
  //Map files to struct
  let files = fs.readdirSync(TRANSCRIPT_FOLDER)
    .filter(e => e.includes(TRANSCRIPT_NAME))
    .map(e => {
      return {
        path: TRANSCRIPT_FOLDER + '/' + e,
        selected: false
      }
    })
  if (files[0]) files[0].selected = true

  while (true) {
    //Draw files
    console.clear()
    console.log('RETURN - Select | D - Delete | CTRL+C - Quit')
    for (let e of files) {
      let file_json = JSON.parse(fs.readFileSync(e.path, 'utf8'))
      let first_message = file_json.messages[1].content[0].text || file_json.messages[1].content //Complies with plaintext and vision api structs

      if (e.selected) process.stdout.write(ACCENT_COLOR)
      console.log(`${e.path} => `, first_message.split('\n')[0].substr(0, 64)) //Show first message
      if (e.selected) process.stdout.write(RESET)
    }

    if (files.length == 0) {
      console.clear()
      console.log('No conversations to manage!')
      process.exit(0)
    }

    //treat new command
    let cmd = await readNextKeyCommand()
    let curr = files.findIndex(e => e.selected)
    if (cmd == 'up' && files[curr - 1]) {
      files[curr].selected = false
      files[curr - 1].selected = true
    }
    else if (cmd == 'down' && files[curr + 1]) {
      files[curr].selected = false
      files[curr + 1].selected = true
    }
    else if (cmd == 'enter') { //Copy hist to curr process
      let curr_file = fs.readFileSync(files[curr].path, 'utf8')
      fs.writeFileSync(TRANSCRIPT_PATH, curr_file)
      process.exit(0)
    }
    else if (cmd == 'd') { //Nuke hist file
      try {
        fs.unlinkSync(files[curr].path)
        files.splice(curr, 1)
        if (files[curr]) files[curr].selected = true
        else if (files[curr - 1]) files[curr - 1].selected = true
      } catch (e) { } //For now do nohing on permission error
    }
  }
}

const clearCurrentConvo = () => {
  try { fs.unlinkSync(TRANSCRIPT_PATH) }
  catch (e) { console.log(e.message) }
  process.exit(0)
}

const performRequest = () => {
  //Adding our message to state.
  conversation_state['messages'].push({
    'role': 'user',
    'content': input,
  })

  const body = JSON.stringify({
    messages: conversation_state['messages'],
    model: MODEL,
    user: 'super_user' //dinamyze
  })

  //New OpenAI COT models dont support these params
  if (!MODEL.includes('o1-')) {
    body.max_tokens = MAX_TOKENS
    body.temperature = TEMPERATURE
  }

  const options = {
    host: HOST,
    path: ENDPOINT,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
    }
  }

  const request = https.request(options, (response) => {
    let data = ""
    response.on('data', (chunk) => {
      data += chunk
    })

    response.on('end', () => {
      processResponse(JSON.parse(data))
    })
  })

  request.write(body)
  request.on('error', (e) => {
    console.error('HTTP request error. Message ahead:\n' + e)
  })
  request.end()
}

//Get any input piped from stdin if available. Can explode reading larger files. TODO: Optimize
if (input) input += '\n'
process.stdin.on('data', d => { input += d })

//For normal calling
process.stdin.on('pause', async () => {
  await init()
})

//For piping situations
process.stdin.on('end', async () => {
  await init()
})

//If no input piped to stdin, pause it and start program
if (process.stdin.isTTY) {
  process.stdin.emit('pause');
}
