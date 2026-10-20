// test/helpers/dom-stub.cjs
//
// A minimal fake DOM for testing the KimFlow renderer.
//
// The renderer was previously untested, which is why defects that need a DOM
// to reproduce (the Gemini-key wipe, the settings-state revert) could ship
// unnoticed. This stub covers only what the renderer actually touches:
// element properties, class/dataset, a class-selector query, a class-based
// `closest`, and event dispatch.
//
// It is deliberately NOT a DOM implementation. If a test needs behaviour this
// stub does not model, extend the stub rather than reaching for a real DOM.

'use strict';

/** Split a class string into a list of class names. */
function classNames(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

/**
 * The browser's `Option` constructor. The renderer uses `new Option(text,
 * value)` when populating a `<select>`, and the transpiled module looks it up
 * as a global, so it has to exist on `globalThis`.
 */
class Option {
  constructor(text, value) {
    this.tagName = 'OPTION';
    this.textContent = text;
    this.value = value;
    this.parent = null;
    this.children = [];
  }
}

/**
 * Build a `classList` that keeps the element's `className` truthful.
 */
function createClassList(element) {
  const sync = () => {
    element.className = [...element._classes].join(' ');
  };
  return {
    add(...names) {
      for (const name of names) if (name) element._classes.add(name);
      sync();
    },
    remove(...names) {
      for (const name of names) element._classes.delete(name);
      sync();
    },
    contains(name) {
      return element._classes.has(name);
    },
    toggle(name, force) {
      const on = force === undefined ? !element._classes.has(name) : Boolean(force);
      if (on) element._classes.add(name);
      else element._classes.delete(name);
      sync();
      return on;
    },
  };
}

/**
 * Create a stub element.
 *
 * @param {object} props initial properties (className, dataset, value, ...)
 */
function createElement(props = {}) {
  const element = {
    tagName: 'DIV',
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    title: '',
    type: '',
    dataset: {},
    children: [],
    parent: null,
    options: [],
    listeners: new Map(),
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return ''; },
    },
    focus() {},
    blur() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
  };
  element._classes = new Set(classNames(props.className));
  delete props.className;
  Object.assign(element, props);

  element.classList = createClassList(element);
  element.className = [...element._classes].join(' ');

  // A <select>'s `options` is derived from its OPTION children, exactly as
  // the browser derives it.
  Object.defineProperty(element, 'options', {
    configurable: true,
    get() {
      return this.children.filter((child) => child.tagName === 'OPTION');
    },
  });

  element.append = (...nodes) => {
    for (const node of nodes) {
      node.parent = element;
      element.children.push(node);
    }
  };
  element.replaceChildren = (...nodes) => {
    element.children = [];
    for (const node of nodes) {
      node.parent = element;
      element.children.push(node);
    }
  };
  element.removeChild = (node) => {
    element.children = element.children.filter((child) => child !== node);
    node.parent = null;
  };

  /**
   * Match a selector against an element's own classes.
   *
   * Only class selectors are supported, and a compound selector
   * (`.toggle-btn.active`) requires every listed class to be present.
   */
  const matches = (element, selector) => {
    if (typeof selector !== 'string' || !selector.startsWith('.')) return false;
    return selector
      .slice(1)
      .split('.')
      .filter(Boolean)
      .every((name) => element._classes.has(name));
  };

  element.querySelectorAll = (selector) => {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(element);
    return found;
  };
  element.querySelector = (selector) => element.querySelectorAll(selector)[0] || null;

  element.closest = (selector) => {
    let node = element;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parent;
    }
    return null;
  };

  element.addEventListener = (type, handler) => {
    if (!element.listeners.has(type)) element.listeners.set(type, []);
    element.listeners.get(type).push(handler);
  };
  element.removeEventListener = (type, handler) => {
    const handlers = element.listeners.get(type);
    if (!handlers) return;
    element.listeners.set(type, handlers.filter((entry) => entry !== handler));
  };
  /** Invoke every listener registered for `type` on this element. */
  element.emit = (type, event = {}) => {
    const handlers = element.listeners.get(type) || [];
    for (const handler of handlers) handler(event);
  };

  return element;
}

/**
 * Build a fake DOM.
 *
 * @param {object} [elements] map of id -> initial element properties.
 *   A string value becomes the element's initial `textContent`.
 * @returns {{document: object, window: object, byId: Function, dispatch: Function, createButton: Function}}
 */
function createDom(elements = {}) {
  const registry = new Map();

  const byId = (id) => {
    if (!registry.has(id)) {
      const initial = elements[id] || {};
      const props = typeof initial === 'string' ? { textContent: initial } : { ...initial };
      registry.set(id, createElement(props));
    }
    return registry.get(id);
  };

  const document = {
    documentElement: createElement(),
    body: createElement(),
    // Every id resolves, creating the element on demand: the real document
    // has all of the app's ids, and `src/dom.ts` resolves them all at import
    // time with a non-null assertion.
    getElementById: (id) => byId(id),
    querySelectorAll: (selector) => {
      const found = [];
      for (const element of registry.values()) {
        for (const child of element.querySelectorAll(selector)) found.push(child);
      }
      return found;
    },
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    createElement: (tagName) => createElement({ tagName }),
    addEventListener() {},
    removeEventListener() {},
  };

  const window = {
    document,
    Option,
    addEventListener() {},
    removeEventListener() {},
  };

  // The transpiled renderer module resolves `Option` as a bare global.
  if (typeof globalThis.Option === 'undefined') globalThis.Option = Option;

  /** Dispatch an event on the element with the given id. */
  const dispatch = (id, type, extra = {}) => {
    const element = byId(id);
    const event = {
      type,
      target: element,
      currentTarget: element,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...extra,
    };
    element.emit(type, event);
    return event;
  };

  /** Create a standalone button element (not registered in the DOM). */
  const createButton = (props = {}) => createElement({ tagName: 'BUTTON', ...props });

  /**
   * Build the named-export shape a renderer module imports from './dom'.
   *
   * `src/dom.ts` exports one binding per element id; a test replaces that
   * module wholesale, so it needs the same shape. Names map to ids by
   * kebab-casing the camelCase binding (`providerSelect` -> `provider-select`);
   * pass an explicit `{ name: id }` map to override.
   *
   * @param {string[]|object} names
   * @returns {object} module exports
   */
  const exports = (names) => {
    const entries = Array.isArray(names)
      ? names.map((name) => [name, name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)])
      : Object.entries(names);
    const module = {};
    for (const [name, id] of entries) module[name] = byId(id);
    return module;
  };

  return { document, window, byId, dispatch, createButton, createElement, exports };
}

module.exports = { createDom, createElement };
