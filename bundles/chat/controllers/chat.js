
// Require dependencies
const Controller  = require('controller');
const escapeRegex = require('escape-string-regexp');

// Require models
const Chat        = model('chat');
const User        = model('user');
const ChatMessage = model('chatMessage');

// require helpers
const chatHelper = helper('chat');
const syncHelper = helper('sync');

/**
 * Build chat controller
 *
 * @acl   true
 * @fail  next
 * @mount /chat
 */
class ChatController extends Controller {
  /**
   * Construct chat controller
   */
  constructor() {
    // Run super
    super();

    // bind build methods
    this.build = this.build.bind(this);

    // set building
    this.building = this.build();
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // BUILD METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * builds chat controller
   */
  build() {

  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // CRUD METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * create action
   *
   * @param  {Array}  ids
   * @param  {Object} opts
   *
   * @call   chat.create
   * @return {Promise}
   */
  async createAction(ids, hash, opts) {
    // update
    if (!opts) {
      opts = hash;
      hash = JSON.stringify(ids);
    }

    // get users
    const users = await Promise.all(ids.map(user => User.findById(user)));

    // create chat
    const chat = await chatHelper.create(opts.user, users, {}, hash);

    // return chat
    return await chat.sanitise(opts.user);
  }

  /**
   * socket listen action
   *
   * @param  {String} id
   * @param  {Object} opts
   *
   * @call   chat.all
   * @return {Async}
   */
  async allAction(opts) {
    // search users
    const chats = await chatHelper.all(opts.user);

    // sanitise users
    return await Promise.all(chats.map(chat => chat.sanitise(opts.user)));
  }

  /**
   * socket listen action
   *
   * @param  {String} id
   * @param  {Object} opts
   *
   * @call   chat.members
   * @return {Async}
   */
  async membersAction(search, opts) {
    // set query
    let users = [];
    const query = User;

    // hook
    await this.eden.hook('chat.users', { search, query, opts }, async () => {
      // find users
      users = await query.match('username', new RegExp(escapeRegex(search.toString().toLowerCase()), 'i')).sort('active', -1).limit(20).find();
    });

    // sanitise users
    return await Promise.all(users.filter(user => user.get('_id').toString() !== opts.user.get('_id').toString()).map(user => user.sanitise()));
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // MEMBER METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * update chat action
   *
   * @param  {String} id
   * @param  {String} key
   * @param  {*}      value
   * @param  {Object} opts
   *
   * @call   chat.member.set
   * @return {Promise}
   */
  async memberSetAction(id, key, value, opts) {
    // load chat
    const chat = await Chat.findById(id);

    // cuser
    await chatHelper.member.set(opts.user, chat, key, value);

    // return chat
    return await chat.sanitise(opts.user);
  }

  /**
   * update chat action
   *
   * @param  {String} id
   * @param  {String} key
   * @param  {*}      value
   * @param  {Object} opts
   *
   * @call   chat.member.read
   * @return {Promise}
   */
  async memberReadAction(id, read, opts) {
    // load chat
    const chat = await Chat.findById(id);

    // set read
    await chatHelper.member.read(opts.user, chat, read);

    // return sanitised
    return await chat.sanitise(opts.user);
  }

  /**
   * update chat action
   *
   * @param  {String}  id
   * @param  {Boolean} isTyping
   * @param  {*}       value
   * @param  {Object}  opts
   *
   * @call   chat.member.typing
   * @return {Promise}
   */
  async memberTypingAction(id, isTyping, opts) {
    // load chat
    const chat = await Chat.findById(id);

    // await typing
    await chatHelper.member.typing(opts.user, chat, isTyping);

    // return typing
    return chat.get(`typing.${opts.user.get('_id').toString()}`);
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // MESSAGE METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * update chat action
   *
   * @param  {String} id
   * @param  {String} key
   * @param  {*}      value
   * @param  {Object} opts
   *
   * @call   chat.message.send
   * @return {Promise}
   */
  async messageSendAction(id, data, opts) {
    // load chat
    const chat = await Chat.findById(id);

    // send message
    const message = await chatHelper.message.send(opts.user, chat, data);

    // return chat
    return await message.sanitise();
  }

  /**
   * update chat action
   *
   * @param  {String} id
   * @param  {String} react
   * @param  {Object} opts
   *
   * @call   chat.message.react
   * @return {Promise}
   */
  async messageReactAction(id, react, opts) {
    // load chat
    const message = await ChatMessage.findById(id);

    // cuser
    await chatHelper.message.react(opts.user, message, react);

    // return chat
    return true;
  }

  // ////////////////////////////////////////////////////////////////////////////
  //
  // MODEL LISTEN METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////


  /**
   * socket listen action
   *
   * @param  {String} id
   * @param  {Object} opts
   *
   * @call   model.listen.chat
   * @return {Async}
   */
  async listenAction(id, uuid, opts) {
    // / return if no id
    if (!id) return null;

    // join room
    opts.socket.join(`chat.${id}`);

    // add to room
    return await syncHelper.addListener(await Chat.findById(id), {
      user      : opts.user,
      atomic    : true,
      listenID  : uuid,
      sessionID : opts.sessionID
    });
  }

  /**
   * socket listen action
   *
   * @param  {String} id
   * @param  {Object} opts
   *
   * @call   model.deafen.chat
   * @return {Async}
   */
  async deafenAction(id, uuid, opts) {
    // / return if no id
    if (!id) return null;

    // join room
    opts.socket.leave(`chat.${id}`);

    // add to room
    return await syncHelper.removeListener(await Chat.findById(id), {
      user      : opts.user,
      atomic    : true,
      listenID  : uuid,
      sessionID : opts.sessionID
    });
  }
}

/**
 * Export chat controller
 *
 * @type {ChatController}
 */
module.exports = ChatController;
