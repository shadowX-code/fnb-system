'use strict';
let SHIP=null,RD=null,OP=null,EW=null,SHIPYAW=0;
function machFrame(){} function machLive(){return false;}
let approvalBox=null; let voiceOn=true; let busy=false; function liveSend(){return false;}

const MACH={on:false,mesh:null};

// Upstream Escape hook: hologram plugins remain deliberately disabled.
function machineEscape(){return false;}
