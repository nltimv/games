'use strict';

// Builds levels off the main thread.
//
// game.js is the whole game, but it only touches the DOM when there is one, so
// a worker gets just the generator out of it -- no duplicated logic, and no
// chance of the worker and the page disagreeing about what level N looks like.
importScripts('game.js');

self.onmessage = function (event) {
  const level = event.data.level;
  self.postMessage({ id: event.data.id, board: self.pipelinesGenerator.generate(level) });
};
