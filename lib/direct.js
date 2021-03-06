'use strict';

// taken from stackoverflow. 
function generateUUID() {
  var d = new Date().getTime();
  var uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return ((c == "x" ? r : r & 3 | 8)).toString(16);
  });
  return uuid;
}

// --------------------------------------------------------------------------- 

function* _yield_() {
  if (arguments.length) {
    return yield arguments[0];
  } else {
    return yield;
  }
}


// --------------------------------------------------------------------------- 
/*
function exec(job) {
  var coroutine = job.shift();
  var argument = job.shift(); 
  var generatorValue = coroutine.generator.next(argument); 
  var handler = generatorValue.value;
    
  if (handler) {
    handler.apply(this, [coroutine]);
  }
}

function spawn(fn, args) {
  args = args !== undefined ? args : [];
  var generator = fn.apply(null, args);
  var coroutine = {
    generator: generator
  };
  exec([coroutine]);
  return coroutine;
}
*/

var Machine = function() {
  this.jobs = [];
  this.active = false;
  this.events = {};
}


Machine.prototype.isActive = function() {
  return this.active;
};

Machine.prototype.hasJobs = function() {
  return this.jobs.length > 0;
};

Machine.prototype.addCoroutine = function(fn,args) {
  args = args !== undefined ? args : [];
  var generator = fn.apply(null, args);
  return this.addJobGenerator(generator);
};

Machine.prototype.addJobGenerator = function(generator) {
  var uuid = generateUUID();
  var coroutine = { };
  coroutine.uuid = uuid;
  coroutine.callbacks = [];
  coroutine.done = false;
  coroutine.generator = function*() {
    yield* generator;
    coroutine.done = true;
    for (var i = 0; i < coroutine.callbacks.length; i++) {
      coroutine.callbacks[i]();
    }
  }();
  this.addJob([coroutine]);
  return coroutine;
};



Machine.prototype.run = function() {
  this.active = true;
  while (this.jobs.length) {
    var job = this.jobs.shift();
    var coroutine = job.shift();
    var argument = job.shift(); 
    var generatorValue = coroutine.generator.next(argument); 
    this.handle(coroutine, generatorValue);
  }
  this.active = false;
};


Machine.prototype.wakeup = function() {
  if (!this.active) {
    this.run();
  }
};

Machine.prototype.handle = function(coroutine, generatorValue) {
  var handler = generatorValue.value;
  if (!handler) return;
  handler.apply(this, [coroutine]);
};

Machine.prototype.addJobs = function(newJobs) {
  this.jobs = this.jobs.concat(newJobs);
};

Machine.prototype.addJob = function(newJob) {
  this.jobs.unshift(newJob);
};


Machine.prototype.addJobCallback = function(newJob) {
  this.addCoroutine(function*() { newJob(); });
  //this.jobs.unshift(());
};


Machine.prototype.emit = function(address, value) {
  var addressString = address.join('/'); 
  var listeners = this.events[addressString] = this.events[addressString] || [];
  for (var i = 0; i < listeners.length;) {
    var listener = listeners[i];
    if (listener.once) {
      listener.callback(value);
      listeners.splice(i, 1);
    } else {
      listener.callback(value);
      i++;
    }
  }
  if (listeners.length == 0)
    delete this.events[addressString];
}

Machine.prototype.once = function(address, fn) {
  var addressString = address.join('/'); 
  this.events[addressString] = this.events[addressString] || [];
  this.events[addressString].push({ once: true, callback: fn });
}

Machine.prototype.onceAddJob = function(address, job) {
  var machine = this;
  this.once(address, function() {
    machine.addJob(job);
  });
}


Machine.prototype.onceAddJobApplyEvent = function(address, coroutine) {
  var machine = this;
  this.once(address, function(value) {
    machine.addJob([coroutine, value]);
  });
};


Machine.prototype.listenersCount = function(address) {
  var addressString = address.join('/'); 
  if (!this.events[addressString]) return 0;
  return this.events[addressString].length; 
}


// --------------------------------------------------------------------------- 

var Inbox = function(capacity) {
  this.capacity = capacity;
  this.messages = [];
  return;
};

Inbox.prototype.isFull = function() {
  if (this.capacity == -1) return false;
  else return this.messages.length >= this.capacity; 
};

Inbox.prototype.isEmpty = function() {
  return this.messages.length == 0;
};

Inbox.prototype.push = function(message) {
  this.messages.push(message);
};

Inbox.prototype.pop = function() {
  return this.messages.pop();
};

// --------------------------------------------------------------------------- 

/*
var EventEmitter = function() {
  this.events = { };
  return;
}

EventEmitter.prototype.listenersCount = function(eventName) {
  if (!this.events[eventName]) return 0;
  return this.events[eventName].length;  
}

*/



// Semaphores                                                                  
// --------------------------------------------------------------------------- 
var Semaphore = function(n) {
  this.counter = n || 0;
}

Semaphore.prototype.put = function() {
  this.counter++;
}

Semaphore.prototype.take = function() {
  this.counter--;
  if (this.counter == 0) {
    callback();    
  }
}



// Latch                                                                       
// --------------------------------------------------------------------------- 
var Latch = function(callback) {
  this.counter = 0;
  this.callback = callback;
}

Latch.prototype.put = function() {
  this.counter++;
  if (this.counter == 0) {
    this.callback();    
  }
}

Latch.prototype.take = function() {
  this.counter--;
}




// Two-way Sync Channels                                                       
// --------------------------------------------------------------------------- 


function makeTwoWaySyncChannel() {
  var obj = { };

  var channels = [
    makeSingleSyncChannel(),
    makeSingleSyncChannel()
  ];
  
  obj.endpoints = [
    { channel: obj, input: channels[0][0], output: channels[1][1] },
    { channel: obj, input: channels[1][0], output: channels[0][1] }
  ];

  return obj.endpoints;
}

function* twoWaySyncChannelWrite(channelReference, value) {
  var evt = {
    channelReference: channelReference.output,
    //channelReference: channelReference,
    value: value
  };
  //return yield* _yield_(function(coroutine) { return twoWaySyncChannelWriteHandler.apply(this, [coroutine, evt]); });
  return yield* _yield_(function(coroutine) { return singleSyncChannelWriteHandler.apply(this, [coroutine, evt]); });
}

function* twoWaySyncChannelRead(channelReference) {
  var evt = {
    //channelReference: channelReference
    channelReference: channelReference.input
  };
  //return yield* _yield_(function(coroutine) { return twoWaySyncChannelReadHandler.apply(this, [coroutine, evt]); });
  return yield* _yield_(function(coroutine) { return singleSyncChannelReadHandler.apply(this, [coroutine, evt]); });
}

function _ats2keh_ch2make() {
  return makeTwoWaySyncChannel();
}

function* _ats2keh_ch2recv_kehyield_(ch) {
  return yield* twoWaySyncChannelRead(ch);
}

function* _ats2keh_ch2send_kehyield_(ch, v) {
  return yield* twoWaySyncChannelWrite(ch, v);
}





// One-way Sync Channels                                                       
// --------------------------------------------------------------------------- 

function makeSingleSyncChannel() {
  var channel = { };
  channel.writers = [
    { channel: channel }
  ];

  channel.readers = [
    { channel: channel, inbox: new Inbox(0) }
  ];

  return [channel.readers[0], channel.writers[0]];
}

function* singleSyncChannelWrite(channelReference, value) {
  var evt = {
    channelReference: channelReference,
    value: value
  };
  return yield* _yield_(function(coroutine) { return singleSyncChannelWriteHandler.apply(this, [coroutine, evt]); });
}

function* singleSyncChannelRead(channelReference) {
  var evt = {
    channelReference: channelReference
  };
  return yield* _yield_(function(coroutine) { return singleSyncChannelReadHandler.apply(this, [coroutine, evt]); });
}

function _ats2keh_ch1indup(channelReference) {
  var channel = channelReference.channel;
  var duplicate = { channel: channel, inbox: new Inbox(0) };
  channel.readers.push(duplicate);
  return duplicate;
}

function _ats2keh_ch1outdup(channelReference) {
  var channel = channelReference.channel;
  var duplicate = { channel: channel };
  channel.writers.push(duplicate);
  return duplicate;
}



function _ats2keh_ch2dup(ch2endpt) {
  return  { input: _ats2keh_ch1indup(ch2endpt.input), output: _ats2keh_ch1outdup(ch2endpt.output) };
}





function singleSyncChannelWriteHandler(owner, evt) {
  var channelReference = evt.channelReference;
  var channel = channelReference.channel;
  var machine = this;

  channelReference.latch = new Latch(function() {
    delete channelReference['latch'];
    machine.addJob([owner]);
  });

  channelReference.latch.take();

  var msg = {
    callback: function() { channelReference.latch.put(); },
    value: evt.value
  }

  for (var i = 0; i < channel.readers.length; i++) {
    channelReference.latch.take();
    var reader = channel.readers[i];
    if (reader.callback) {
      reader.callback(msg);
    } else {
      reader.inbox.push(msg);
    }
  }

  channelReference.latch.put();
}

function singleSyncChannelReadHandler(owner, evt) {
  var channelReference = evt.channelReference;
  var channel = channelReference.channel;
  var machine = this;

  if (channelReference.inbox.isEmpty()) {
    channelReference.callback = function(msg) {
      delete channelReference['callback'];
      machine.addJob([owner, msg.value]);
      machine.addJobCallback(function() { msg.callback(); });
    }
  } else {
    var msg = channelReference.inbox.pop();
    machine.addJob([owner, msg.value]);
    machine.addJobCallback(function() { msg.callback(); });
  }
}

function singleSyncChannelLink(M, output, input) {
  M.addCoroutine(function*() {
    while (true) {
      yield* singleSyncChannelWrite(input, yield* singleSyncChannelRead(output));
    }
  });
}












// Timers                                                                      
// --------------------------------------------------------------------------- 

function* sleep(ms) {
  var uuid = generateUUID();
  var evt = {
    uuid: uuid,
    type: 'sleep',
    milliseconds: ms
  };
  return yield* _yield_(function(coroutine) { return sleepHandler.apply(this, [coroutine, evt]); });
}

function sleepHandler(owner, evt) {
  var machine = this;
  setTimeout(function() {
    machine.addJob([owner]);
    machine.wakeup();
  }, evt.milliseconds);
}

// WebSocket Channel                                                           
// --------------------------------------------------------------------------- 

function makeWebSocketChannel(M, address) {
  var [wschan, userchan] = makeTwoWaySyncChannel();
  var ws = new WebSocket(address);

  // register consumer that sends messages through the ws. 
  ws.onopen = function() {
    M.addCoroutine(function*() {
      while (true) {
        var msg = yield* twoWaySyncChannelRead(wschan);
        ws.send(msg);
      }
    });
    M.wakeup();
  };

  // reads from the ws, and sends to the user.
  ws.onmessage = function(evt) {
    M.addCoroutine(function*() {
      yield* twoWaySyncChannelWrite(wschan, evt.data);
    });
    M.wakeup();
  };

  return userchan;
}

// Multi-endpoint Channel                                                      
// --------------------------------------------------------------------------- 
/*
function makeMultiChannel(M, n) {
  var uuid    = generateUUID();
  var internalEndpoints = [];
  var externalEndpoints = [];

  for (var i = 0; i < n; i++) {
    var [chneg, chpos] = makeDualChannel();
    internalEndpoints.push(chneg);
    externalEndpoints.push(chpos);
  }

  for (var i = 0; i < n; i++) {
    channelTwoLink(M, internalEndpoints[i], internalEndpoints[(i + 1) % n]);
  }

  return externalEndpoints;
}
*/





// ATS Bindings                                                                
// --------------------------------------------------------------------------- 
var M = new Machine();

// --------------------------------------------------------------------------- 
function _ats2keh_ch1make() {
  return makeSingleSyncChannel();
}

function* _ats2keh_ch1send_kehyield_(channelReference, value) {
  return yield* singleSyncChannelWrite(channelReference, value);
}

function* _ats2keh_ch1recv_kehyield_(channelReference) {
  return yield* singleSyncChannelRead(channelReference);
}



function _ats2keh_ch1inclose(channelReference) {
  var channel = channelReference.channel;
  var index = channel.readers.indexOf(channelReference);
  if (index > -1) {
    channel.readers.splice(index, 1);
  }

  return;
}



function _ats2keh_ch1outclose(channelReference) {
  var channel = channelReference.channel;
  var index = channel.readers.indexOf(channelReference);
  if (index > -1) {
    channel.readers.splice(index, 1);
  }

  return;
}

function _ats2keh_ch1link(input, output) {
  return singleSyncChannelLink(M, input, output);
}




// --------------------------------------------------------------------------- 

function applyClosure(closure) {
  var fn   = closure[0];
  var args = closure;
  return fn.apply(this, [args]);
}

function evalClosure(closure) {
  var fn   = closure[0];
  var args = closure;
  //var args = [closure];
  //return function() { return fn.apply(this, args); };
  return function() { return fn(args); };
}



// --------------------------------------------------------------------------- 

function _ats2keh_makeWebSocketChannel(address) {
  return makeWebSocketChannel(M, address);
}

function _ats2keh_makeDualChannel(capacity0, capacity1) {
  return makeDualChannel(capacity0, capacity1);
}

function _ats2keh_addCoroutine(fn, args) {
  args = args || [];
  if (fn.constructor.name == 'GeneratorFunction') {
    return M.addCoroutine(fn, args);
  } else {
    return M.addJobCallback(function() {
      fn.apply(this, args);
    });
  }
}





function* _ats2keh_sleep_kehyield_(ms) {
  return yield* sleep(ms);
}


function _ats2keh_ch2link(ch0, ch1) {
 _ats2keh_ch1link(ch1.input, ch0.output);
 _ats2keh_ch1link(ch0.input, ch1.output);
 // ch1link(M, ch0.output, ch1.input); 
 // ch1link(M, ch1.output, ch0.input); 
}

function _ats2keh_ch2close(channelReference) {
  _ats2keh_ch1inclose(channelReference.input);
  _ats2keh_ch1outclose(channelReference.output);
  return;
}


function _ats2keh_ch2split(ch2endpt) {
  return [ch2endpt.input, ch2endpt.output];
}


function _ats2keh_wakeup() {
  setTimeout(function() { M.wakeup(); }, 0);
}


function _ats2keh_go_cloptr(fn) {
  var x = applyClosure(fn);
  var c = M.addJobGenerator(x);
  return c;
}





var _ats2keh_kehyield_ = _yield_;


function* _ats2keh_join_kehyield_(coroutine) {
  var [cin, cout] = _ats2keh_ch1make();
  function done() {
    M.addCoroutine(function*() {
      return yield* _ats2keh_ch1send_kehyield_(cout, true);
    });
    M.wakeup();
  }
  if (coroutine.done) {
    done();
  } else {
    coroutine.callbacks.push(done);
  }
  return yield* _ats2keh_ch1recv_kehyield_(cin);
}

window.addEventListener("load", function load(event){
  window.removeEventListener("load", load, false);
  (function(){
    M.wakeup();
    var main0 = window.main0;
    if (main0 && main0.constructor) {
      if (main0.constructor.name === 'GeneratorFunction') M.addCoroutine(main0);
      else if (main0.constructor.name === 'Function') M.addJobCallback(main0);
      M.wakeup();
    }
  })();
});

