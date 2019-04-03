
// import dependencies
const uuid        = require('uuid');
const socket      = require('socket');
const Helper      = require('helper');
const toText      = require('html-to-text');
const autolinker  = require('autolinker');

// require models
const Chat    = model('chat');
const File    = model('file');
const Image   = model('image');
const CUser   = model('chatUser');
const Message = model('chatMessage');

/**
 * extend chat helper
 *
 * @extends {helper}
 */
class ChatHelper extends Helper {
  /**
   * construct notification helper
   */
  constructor() {
    // run super
    super();

    // bind CRUD methods
    this.all = this.all.bind(this);
    this.create = this.create.bind(this);

    // bind member methods
    this.member = {
      set    : this.memberSet.bind(this),
      read   : this.memberRead.bind(this),
      typing : this.memberTyping.bind(this),
    };

    // send message
    this.message = {
      set         : this.messageSet.bind(this),
      send        : this.messageSend.bind(this),
      react       : this.messageReact.bind(this),
      remove      : this.messageRemove.bind(this),
      buttonPress : this.messageButtonPress.bind(this),
    };
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // CRUD METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * creates or finds existing chat
   *
   * @param  {*} member
   *
   * @return {*}
   */
  async all(member) {
    // return chats by member
    return (await Promise.all((await CUser.where({
      'member.id' : member.get('_id').toString(),
    }).ne('opened', false).find()).map(cUser => cUser.get('chat')))).filter(chat => chat);
  }

  /**
   * creates or finds existing chat
   *
   * @param  {*}     member
   * @param  {Array} members
   *
   * @return {*}
   */
  async create(member, members, opts = {}, hash = null) {
    // set ids
    const ids = (members.map(m => (m.id || m.get('_id').toString())).sort()).reduce((accum, id) => {
      // check id in array
      if (!accum.includes(id)) accum.push(id);

      // return accum
      return accum;
    }, []);

    // no chats with one user
    if (ids.length === 1) return null;

    // load chat
    const chat = await Chat.where({
      hash : hash || members.map(m => (m.id || m.get('_id').toString())).sort().join(':'),
    }).findOne() || new Chat({
      type    : 'public', // as default
      uuid    : uuid(),
      hash    : hash || members.map(m => (m.id || m.get('_id').toString())).sort().join(':'),
      creator : member,
    });

    // update chat members
    chat.set('members', members);

    // update chat with all provided options
    if (opts) {
      // set options
      chat.set(opts);
    }

    // set data
    const data = {};

    // await hook
    await this.eden.hook('eden.chat.create', {
      ids, chat, data, member,
    }, async () => {
      // save message
      if (!data.prevent) await chat.save();
    });

    // loop users
    members.forEach(async (m) => {
      // user stuff
      const cUser = await CUser.findOne({
        'chat.id'   : chat.get('_id').toString(),
        'member.id' : (m.id || m.get('_id').toString()),
      }) || new CUser({
        chat,

        member : m,
      });

      // save cuser
      await cUser.save();
    });

    // hooks
    if (!chat.get('_id')) return null;

    // emit
    this.eden.emit('eden.chat.create', await chat.sanitise(), true);

    // emit
    if (member) socket.user(member, 'chat.create', await chat.sanitise(member));

    // return cuser
    return chat;
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // MEMBER METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * member set action
   *
   * @param  {*}      member
   * @param  {Chat}   chat
   * @param  {String} key
   * @param  {*}      value
   *
   * @return {Promise}
   */
  async memberSet(member, chat, key, value) {
    // user stuff
    const cUser = await CUser.findOne({
      'chat.id'   : chat.get('_id').toString(),
      'member.id' : member.get('_id').toString(),
    }) || new CUser({
      chat,
      member,
    });

    // set style
    cUser.set(key, value);

    // set data
    const data = {};

    // await hook
    await this.eden.hook('eden.chat.member.set', {
      chat, data, key, value, member, cUser,
    }, async () => {
      // save message
      if (!data.prevent) await cUser.save();
    });

    // hooks
    if (!chat.get('_id')) return null;

    // emit to socket
    socket.user(member, `model.update.chat.${chat.get('_id').toString()}`, {
      [key] : cUser.get(key),
    });

    // return cuser
    return cUser;
  }

  /**
   * member set action
   *
   * @param  {*}    member
   * @param  {Chat} chat
   * @param  {Date} read
   *
   * @return {Promise}
   */
  async memberRead(member, chat, read) {
    // get chat user
    const cUser = await CUser.findOne({
      'chat.id'   : chat.get('_id').toString(),
      'member.id' : member.get('_id').toString(),
    }) || new CUser({
      chat,
      member,
    });

    // set read
    cUser.set('read', new Date(read));
    cUser.set('unread', await Message.where({
      'chat.id' : chat.get('_id').toString(),
    }).ne('from.id', member.get('_id').toString()).gt('created_at', new Date(cUser.get('read') || 0)).count());

    // save chat
    await cUser.save();

    // emit to socket
    socket.user(member, `model.update.chat.${chat.get('_id').toString()}`, {
      unread : cUser.get('unread'),
    });

    // emit read
    this.eden.emit('eden.chat.member.read', {
      id     : chat.get('_id').toString(),
      when   : cUser.get('read'),
      member : member.get('_id').toString(),
    }, true);

    // return cuser
    return cUser;
  }

  /**
   * member set action
   *
   * @param  {*}       member
   * @param  {Chat}    chat
   * @param  {Boolean} isTyping
   *
   * @return {Promise}
   */
  async memberTyping(member, chat, isTyping) {
    // set typing
    if (isTyping) {
      // set typing
      chat.set(`typing.${member.get('_id').toString()}`, new Date());
    } else {
      // unset typing
      chat.unset(`typing.${member.get('_id').toString()}`);
    }

    // save chat
    await chat.save();

    // sanitise chat
    const sanitised = await chat.sanitise();

    // emit to socket
    socket.room(`chat.${chat.get('_id').toString()}`, `chat.${chat.get('_id').toString()}.typing`, sanitised.typing.map((item) => {
      // return item
      return {
        when   : item.when.getTime() - ((new Date()).getTime() - 5 * 1000),
        member : item.member,
      };
    }));

    // emit read
    this.eden.emit('eden.chat.member.typing', {
      id       : chat.get('_id').toString(),
      member   : member.get('_id').toString(),
      isTyping : chat.get(`typing.${member.get('_id').toString()}`),
    }, true);

    // return typing
    return chat;
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // MESSAGE METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * message send method
   *
   * @param  {*}      member
   * @param  {Chat}   chat
   * @param  {Object} data
   *
   * @return {Promise}
   */
  async messageSend(member, chat, data) {
    // get chat users
    const members = await chat.get('members') || [];

    // create message
    const message = new Message({
      chat,

      raw     : data.message,
      from    : member,
      meta    : data.meta || {},
      react   : data.react || {},
      uuid    : data.uuid || uuid(),
      message : autolinker.link(toText.fromString(data.message)),
      embeds  : (data.embed || data.embeds) || [{
        url       : data.url || null,
        color     : data.color || null,
        title     : data.title || null,
        image     : data.image || null,
        fields    : data.fields || [],
        buttons   : data.buttons || [],
        primary   : data.primary || false,
        thumbnail : data.thumbnail || null,
      }],
    });

    // check embeds
    if (data.embeds) {
      // allow one
      if (!Array.isArray(data.embeds)) data.embeds = [data.embeds];

      // loop embeds
      const embeds = (await Promise.all(data.embeds.map(async (embed) => {
        // get embeds
        if (typeof embed === 'string') {
          // try/catch
          try {
            // await
            return await File.findById(embed) || await Image.findById(embed);
          } catch (err) { global.printError(err); }
        }

        // return null
        return embed;
      }))).filter(e => e);

      // set embeds
      message.set('embeds', embeds);
    }

    // await hook
    await this.eden.hook('eden.chat.message', {
      data, message, chat, member,
    }, async () => {
      // save message
      if (!data.prevent) await message.save();
    });

    // check id
    if (!message.get('_id')) return null;

    // loop users
    await Promise.all(members.map(async (m) => {
      // get chat user
      const cUser = await CUser.findOne({
        'chat.id'   : chat.get('_id').toString(),
        'member.id' : m.get('_id').toString(),
      }) || new CUser({
        chat,

        member : m,
      });

      // set value
      cUser.set('unread', await Message.where({
        'chat.id' : chat.get('_id').toString(),
      }).ne('from.id', m.get('_id').toString()).gte('created_at', new Date(cUser.get('read') || 0)).count());

      // let emitOpen
      let emitOpen = false;

      // create chat
      if (!cUser.get('opened') && !data.preventOpen) {
        // emit
        emitOpen = true;

        // unset cloased
        cUser.set('opened', new Date());
      }

      // save cuser
      await cUser.save();

      // emit
      if (emitOpen) socket.user(m, 'chat.create', await chat.sanitise(m));
    }));

    // save chat
    await chat.save();

    // emit
    this.eden.emit('eden.chat.message', await message.sanitise(true), true);

    // emit to socket
    socket.room(`chat.${chat.get('_id').toString()}`, `chat.${chat.get('_id').toString()}.message`, await message.sanitise());

    // loop users
    members.forEach(async (m) => {
      // get chat user
      const cUser = await CUser.findOne({
        'chat.id'   : chat.get('_id').toString(),
        'member.id' : m.get('_id').toString(),
      }) || new CUser();

      // emit to socket
      socket.user(m, `model.update.chat.${chat.get('_id').toString()}`, {
        unread : cUser.get('unread') || 0,
      });
    });

    // return message
    return message;
  }

  /**
   * message set action
   *
   * @param  {Chat}   message
   * @param  {String} key
   * @param  {*} value
   *
   * @return {Promise}
   */
  async messageSet(message, key, value) {
    // set value
    message.set(key, value);

    const data = {};

    await this.eden.hook('eden.chat.message.set', {
      data, key, value, message,
    }, async () => {
      // save message
      if (!data.prevent) await message.save();
    });

    // emit to socket
    socket.room(`chat.${message.get('chat.id').toString()}`, `model.update.message.${message.get('_id').toString()}`, {
      [key] : message.get(key),
    });
  }

  /**
   * message react action
   *
   * @param  {*}      member
   * @param  {Chat}   message
   * @param  {String} react
   *
   * @return {Promise}
   */
  async messageReact(member, message, react) {
    // check reaction
    if (message.get(`react.${react}.${member.id || member.get('_id').toString()}`)) {
      // unset reaction
      message.unset(`react.${react}.${member.id || member.get('_id').toString()}`);
    } else {
      // set reaction
      message.set(`react.${react}.${member.id || member.get('_id').toString()}`, new Date());
    }

    // set data
    const data = {};

    // do hook
    await this.eden.hook('eden.chat.message.react', {
      data, react, message, member,
    }, async () => {
      // save message
      if (!data.prevent) await message.save();
    });

    // emit to socket
    socket.room(`chat.${message.get('chat.id').toString()}`, `chat.${message.get('chat.id').toString()}.react`, {
      [`react.${react}.${member.id || member.get('_id').toString()}`] : message.get(`react.${react}.${member.id || member.get('_id').toString()}`),
    });
  }

  /**
   * message react action
   *
   * @param  {Chat} message
   *
   * @return {Promise}
   */
  async messageRemove(message) {
    // set data
    const data = {};

    // hook
    await this.eden.hook('eden.chat.message.remove', {
      data, message,
    }, async () => {
      // save message
      if (!data.prevent) await message.save();
    });

    // emit to socket
    socket.room(`chat.${message.get('chat.id').toString()}`, `chat.${message.get('chat.id').toString()}.remove`, {
      'message.remove' : message.get('uuid'),
    });

    // remove message
    await message.remove();
  }

  /**
   * message button press action
   *
   * @param  {*}      member
   * @param  {Chat}   message
   * @param  {String} button
   *
   * @return {Promise}
   */
  async messageButtonPress(member, message, button) {
    const evtData = {
      button,
      message : await message.sanitise(true),
      member  : member.id || member.get('_id'),
    };

    this.eden.emit('eden.chat.message.buttonPress', evtData, true);
    this.eden.emit(`eden.chat.message.buttonPress.${message.get('_id')}`, evtData, true);
  }
}

/**
 * export built chat helper
 *
 * @type {chatHelper}
 */
module.exports = new ChatHelper();
