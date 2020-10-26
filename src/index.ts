//

import * as fs from 'fs'
import * as request from 'request'
import * as download from 'download'
import { mainModule } from 'process'

const emoji = require('node-emoji')

type UsersJSonType = {
  id: string
  name: string
  real_name: string
  profile: {
    image_32: string
  }
}
type ChannelsJsonType = {
  name: string
}
type AttachmentType = {
  name: string
  mimetype: string
  url_private: string
}
type MessageJsonType ={
  type: string
  text: string
  user: string
  ts: string
  files?: AttachmentType[]
}
type UsersTypes = {
  [key: string]: {
    name: string
    iconUrl: string
    iconPath: string
  };
}
type MessageType = {
  userName: string
  userIconPath: string
  date: Date
  html: string
  attachment: null | AttachmentType
}
type ContentType = {
  channelName: string
  messages: MessageType[]
}

const readJsonFile = (path: string): string => {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (e) {
    console.count(`File read error: ${path} -- ${e}`)
    process.exit(-1)
  }
}

const getUsersJson = (slackDir: string): UsersTypes => {
  const usersJson:UsersJSonType[] = JSON.parse(readJsonFile(slackDir + "/users.json"))

  return usersJson.reduce((users, u) => {
    const ext = (new URL(u.profile.image_32)).pathname.match(/\..+$/)[0]
    users[u.id] = {
      name: u.real_name,
      iconPath: u.id + ext,
      iconUrl: u.profile.image_32}
    return users},  {})
}

const getChannelsJson = (slackDir: string): string[] => {
  const channelsJson:ChannelsJsonType[] = JSON.parse(readJsonFile(slackDir + "/channels.json"))
  return channelsJson.map(c => c.name)
}

const ts2date = (ts: string): Date =>  new Date(Number(ts) * 1000)

const text2html = (text: string, users: UsersTypes): string => {
  return emoji.emojify(text).
    replace(/<@.*?>/, x => "<span class='uid'>@" + users[x.substr(2,x.length - 3)]?.name + "</span>").
    replace(/<(http.*?)>/g, "<a href=\"$1\">$1</a>").
    replace(/\n/g, "<br/>").
    replace(/```(.+?)```/g, "<pre>\n$1\n</pre>\n").
    replace(/`(.+?)`/g, "<code>$1</code>")
}

const getChanelContent = (slackDir: string, channelName: string, users: UsersTypes): ContentType => {
  const messageFilePaths = fs.readdirSync(`${slackDir}/${channelName}`)

  let messages:MessageType[] = []
  messageFilePaths.forEach(filePath => {
    const messageJson:MessageJsonType[] = JSON.parse(readJsonFile(`${slackDir}/${channelName}/${filePath}`))
    messageJson.forEach(json => {
      let message:MessageType = {
        userName: users[json.user].name,
        userIconPath:  users[json.user].iconPath,
        date: ts2date(json.ts),
        html: text2html(json.text, users),
        attachment: null}
      if (json.files) {
        message.attachment = {
          name: json.files[0].name,
          mimetype: json.files[0].mimetype,
          url_private: json.files[0].url_private
        }
      }
      //console.log(message)
      messages.push(message)
    })
    messages.sort((a, b) => a.date === b.date ? 0 : (a.date < b.date ? -1 : 1))
  })

  return {channelName: channelName, messages: messages}
}

const date2string = (d: Date): string => (
  d.toLocaleDateString("ja-JP", {year: "numeric", month: "short", day: "numeric", weekday: "short"}) + "&nbsp" +
  ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))

const readTextFile = (path: string): string => {
  const s = fs.readFileSync(path, 'utf8')

  return s.replace(/[&'`"<>]/g, function(match) {
    return {
      '&': '&amp;',
      "'": '&#x27;',
      '`': '&#x60;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    }[match]
  })
}

let lastDate = 0
const isDateChanged = (d: Date): boolean => {
  if (lastDate != d.getDate()) {
    lastDate = d.getDate()
    return true
  }
  return false
}

const makeChannelBodyHtml = (contents: ContentType[], outDir: string): string => {
  return contents.map(content =>
`<h2 class="channel-title">${content.channelName}</h2>
<div class="channel-body">
  ${ content.messages.map(m =>
`   ${ isDateChanged(m.date) ? "<hr>" : ""  }
    <div class="message-icon"><img src="./${m.userIconPath}"></div>
    <div class="message-body">
      <span class="message-user-name">${m.userName}</span>
      <span class="message-date">${date2string(m.date)}</span>
      <p class="message-text">${m.html}</p>
      ${ (m.attachment && m.attachment.mimetype.match(/image/)) ?
        `<img src="${outDir + "/" + m.attachment.name}" class="attachment-image"/>` : "" }
      ${ (m.attachment && m.attachment.mimetype.match(/text/)) ?
         `<pre class="attachment-text">${readTextFile(outDir + "/" + m.attachment.name)}</pre>` : "" }
    </div>`
    ).join("\n") }
</div>`
  ).join("\n")
}

const downloadFile = (url: string, path: string) => {
  request.head(url, (_err, _res, _body) => {
    request(url)
      .pipe(fs.createWriteStream(path))
      .on('close', () => { console.log(`${path} downloaded.`) })
  })
}

const downloadFiles = async (outDir: string, users: UsersTypes, contents: ContentType[]) => {
  await Promise.all(Object.keys(users).map((uid) =>
    download(users[uid].iconUrl, outDir, {filename: users[uid].iconPath})))

  const attachments: AttachmentType[] = contents.reduce((atts, content) =>
    atts.concat(content.messages.filter(message => message.attachment).map(m => m.attachment)),
    [])

  try {
    await Promise.all(attachments.map((attachment) =>
    download(attachment.url_private, outDir, {filename: attachment.name})))
  } catch (e) {
    console.log(`-- Error ${e.statusMessage} : ${e.url}`)
  }

  const css = await fs.promises.readFile("./src/index.css", "utf8")
  await fs.promises.writeFile(outDir + "/index.css", css)
}


const renderHtml = (outDir: string, contens: ContentType[]) => {
  const body = makeChannelBodyHtml(contens, outDir)

  const html = `
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="./index.css">
    </style>
    <title>My App</title>
  </head>
  <body>
    ${body}
  </body>
</html>
`
  fs.writeFileSync(outDir + "/index.html", html)
}

const main = async () => {
  if (process.argv.length === 4) {
    const slackExportDir = process.argv[2].replace(/^~/, process.env.HOME)
    const outputDir = process.argv[3]

    if (!fs.existsSync(slackExportDir)) {
      console.log(`${slackExportDir}: Not exist`)
      process.exit(0)
    }
    if (fs.existsSync(outputDir)) {
      console.log(`${outputDir}: Already exist`)
      process.exit(0)
    }
    fs.mkdirSync(outputDir)

    const users = getUsersJson(slackExportDir)
    const channelNames= getChannelsJson(slackExportDir)
    const conents = channelNames.map(name => getChanelContent(slackExportDir, name, users))

    await downloadFiles(outputDir, users, conents)
    renderHtml(outputDir, conents)
  } else {
    console.log("Usage: node index.js SLACK-EXPORTED-DIR OUTPUT-DIR")
  }
}

main()