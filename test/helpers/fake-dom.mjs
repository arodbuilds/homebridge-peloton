/**
 * A small DOM for rendering the settings page modules under node:test: elements with attributes,
 * classes, dataset, children, text, listeners, and a selector engine covering what the page's
 * queries use (tags, classes, ids, attribute presence, equality, and suffix, descendant and child
 * chains, :scope, and comma-separated groups). installFakeDom() exposes it as window and document,
 * so the page modules (which read both at call time) can be imported afterwards with a dynamic
 * import. Nothing lays out or paints; the tests read the tree the page built.
 */
import { setImmediate } from 'node:timers/promises';

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }

  get textContent() {
    return this.data;
  }
}

const SIMPLE = /^([a-zA-Z*][\w-]*)?((?:[.#][\w-]+|\[[\w-]+(?:[$^*]?=(?:"[^"]*"|[^\]]*))?\])*)$/;
const PIECES = /[.#][\w-]+|\[[\w-]+(?:[$^*]?=(?:"[^"]*"|[^\]]*))?\]/g;
const ATTRIBUTE = /^\[([\w-]+)(?:([$^*]?=)(?:"([^"]*)"|([^\]]*)))?\]$/;

function matchesSimple(node, simple, scope) {
  if (simple === ':scope') {
    return node === scope;
  }
  const parts = SIMPLE.exec(simple);
  if (!parts) {
    throw new Error(`Unsupported selector: ${simple}`);
  }
  const [, tag, rest] = parts;
  if (tag && tag !== '*' && node.tagName !== tag.toUpperCase()) {
    return false;
  }
  for (const piece of rest.match(PIECES) ?? []) {
    if (piece.startsWith('.')) {
      if (!node.classList.contains(piece.slice(1))) {
        return false;
      }
    } else if (piece.startsWith('#')) {
      if (node.getAttribute('id') !== piece.slice(1)) {
        return false;
      }
    } else {
      const [, name, operator, quoted, bare] = ATTRIBUTE.exec(piece);
      const expected = quoted ?? bare ?? '';
      const value = node.getAttribute(name);
      if (value === null) {
        return false;
      }
      if ((operator === '=' && value !== expected) || (operator === '$=' && !value.endsWith(expected))
        || (operator === '^=' && !value.startsWith(expected)) || (operator === '*=' && !value.includes(expected))) {
        return false;
      }
    }
  }
  return true;
}

/** Matches one selector without commas against node, walking ancestors for descendant and child combinators. */
function matchesCompound(node, compound, scope) {
  const tokens = compound.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
  let index = tokens.length - 1;
  if (!matchesSimple(node, tokens[index], scope)) {
    return false;
  }
  let current = node;
  for (index -= 1; index >= 0; index -= 1) {
    let child = false;
    if (tokens[index] === '>') {
      child = true;
      index -= 1;
    }
    const wanted = tokens[index];
    current = current.parentNode;
    if (!child) {
      while (current instanceof FakeElement && !matchesSimple(current, wanted, scope)) {
        current = current.parentNode;
      }
    }
    if (!(current instanceof FakeElement) || !matchesSimple(current, wanted, scope)) {
      return false;
    }
  }
  return true;
}

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.open = false;
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  appendChild(node) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) {
      this.childNodes.splice(at, 1);
      node.parentNode = null;
    }
    return node;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) {
      this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get id() {
    return this.getAttribute('id') ?? '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get type() {
    return this.getAttribute('type') ?? '';
  }

  set type(value) {
    this.setAttribute('type', value);
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get classList() {
    const names = () => this.className.split(/\s+/).filter((name) => name.length > 0);
    return {
      contains: (name) => names().includes(name),
      add: (...added) => {
        this.className = [...new Set([...names(), ...added])].join(' ');
      },
      remove: (...removed) => {
        this.className = names().filter((name) => !removed.includes(name)).join(' ');
      },
      toggle: (name, force) => {
        const on = force ?? !names().includes(name);
        if (on) {
          this.classList.add(name);
        } else {
          this.classList.remove(name);
        }
        return on;
      },
    };
  }

  /** This element, then each ancestor element up to the root. */
  *selfAndAncestors() {
    yield this;
    for (let node = this.parentNode; node instanceof FakeElement; node = node.parentNode) {
      yield node;
    }
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  set hidden(value) {
    if (value) {
      this.setAttribute('hidden', '');
    } else {
      this.removeAttribute('hidden');
    }
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    for (const node of this.childNodes) {
      node.parentNode = null;
    }
    this.childNodes = [];
    if (String(value).length > 0) {
      this.appendChild(new FakeText(value));
    }
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(fn);
    if (at >= 0) {
      list.splice(at, 1);
    }
  }

  /** Runs the listeners for the event's type on this element and then on each ancestor, as bubbling would. */
  dispatchEvent(event) {
    const detail = typeof event === 'string' ? { type: event } : event;
    detail.target ??= this;
    detail.preventDefault ??= () => undefined;
    for (const node of this.selfAndAncestors()) {
      for (const fn of [...(node.listeners.get(detail.type) ?? [])]) {
        fn(detail);
      }
    }
    return true;
  }

  click() {
    if (!this.disabled) {
      this.dispatchEvent('click');
    }
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {
    // Nothing is laid out here.
  }

  matches(selector, scope = null) {
    return selector.split(',').some((group) => matchesCompound(this, group, scope));
  }

  closest(selector) {
    for (const node of this.selfAndAncestors()) {
      if (node.matches(selector)) {
        return node;
      }
    }
    return null;
  }

  *descendants() {
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        yield child;
        yield* child.descendants();
      }
    }
  }

  querySelectorAll(selector) {
    return [...this.descendants()].filter((node) => node.matches(selector, this));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class FakeInputElement extends FakeElement {}

export function createFakeDom() {
  const document = {
    readyState: 'complete',
    activeElement: null,
    listeners: new Map(),
    createElement: (tag) => (tag.toLowerCase() === 'input' ? new FakeInputElement(tag, document) : new FakeElement(tag, document)),
    createElementNS: (_namespace, tag) => new FakeElement(tag, document),
    createTextNode: (text) => new FakeText(text),
    addEventListener(type, fn) {
      document.listeners.set(fn, type);
    },
    removeEventListener(_type, fn) {
      document.listeners.delete(fn);
    },
    getElementById: (id) => document.body.querySelector(`#${id}`),
    querySelector: (selector) => document.body.querySelector(selector),
    querySelectorAll: (selector) => document.body.querySelectorAll(selector),
  };
  document.body = new FakeElement('body', document);
  const window = {
    document,
    /** Callbacks given to window.setTimeout, for a test to run when it wants the debounced push to happen. */
    timeouts: [],
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    setTimeout: (fn) => {
      window.timeouts.push(fn);
      return window.timeouts.length;
    },
    clearTimeout: () => undefined,
    open: () => null,
    matchMedia: () => ({ matches: false }),
  };
  return { document, window };
}

/** Installs a fresh fake DOM as the window, document, and element globals the page modules reference. Returns it. */
export function installFakeDom() {
  const dom = createFakeDom();
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.CSS = { escape: (value) => value };
  // Node exposes navigator through a getter, so it is replaced rather than assigned.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
  return dom;
}

/** Lets pending promise chains settle, for renders that finish after an awaited server answer. */
export async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await setImmediate();
  }
}
