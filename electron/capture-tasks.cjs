'use strict';
// Keep screenshot cleanup alive across overlay close, OCR and application quit.
class CaptureTasks {
  constructor(){this.closed=false;this.tasks=new Set();}
  get size(){return this.tasks.size;}
  run(operation){
    if(this.closed)return Promise.resolve(null);
    const task=Promise.resolve().then(()=>this.closed?null:operation());
    this.tasks.add(task);
    const retire=()=>this.tasks.delete(task);task.then(retire,retire);
    return task;
  }
  close(){this.closed=true;return Promise.allSettled([...this.tasks]);}
}
module.exports={CaptureTasks};
