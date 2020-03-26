
// Require local dependencies
const store = require('core/public/js/store');

// built
let built = null;

/**
 * Build socket class
 */
class ChatStore {
  /**
   * Construct socket class
   */
  constructor() {
    // Bind private methods
    this.build = this.build.bind(this);

    // set building
    this.building = this.build();
  }

  /**
   * build socket store
   *
   * @return {Promise}
   */
  async build() {
    // Pre user
    store.pre('set', (data) => {
      // Check key
      if (data.key !== 'chat') return;

      // Set val
      data.val = this;
    });
  }
}

// built
built = new ChatStore();

/**
 * Export built socket class
 *
 * @type {ChatStore}
 */
window.eden.chat = built;
module.exports = built;
