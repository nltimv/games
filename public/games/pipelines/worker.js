'use strict';

// Builds levels off the main thread.
//
// game.js is the whole game, but it only touches the DOM when there is one, so
// a worker gets just the generator out of it -- no duplicated logic, and no
// chance of the worker and the page disagreeing about what level N looks like.
importScripts('game.js');

self.onmessage = function (event) {
  const level = event.data.level;
  const recipe = event.data.recipe;
  // A level the player has met before comes with the seed that won last time,
  // which turns a search into a single board build.
  const board = recipe
    ? self.pipelinesGenerator.rebuild(level, recipe)
    : self.pipelinesGenerator.generate(level);
  self.postMessage({ id: event.data.id, board: board });
};
