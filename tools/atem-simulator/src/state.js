// In-memory switcher state: a single mix-effect with program/preview, a configured
// input list, and tally derivation. Kept deliberately minimal — exactly what a
// vMix→ATEM tally bridge needs to observe.

import { EventEmitter } from 'node:events';
import { TALLY_PROGRAM, TALLY_PREVIEW } from './commands.js';

export class SwitcherState extends EventEmitter {
  /**
   * @param {object} opts
   * @param {Array<{id:number,longName?:string,shortName?:string}>} opts.inputs
   * @param {number} [opts.program] initial program source id
   * @param {number} [opts.preview] initial preview source id
   */
  constructor({ inputs, program, preview } = {}) {
    super();
    this.inputs = inputs ?? [];
    this.programInput = program ?? this.inputs[0]?.id ?? 1;
    this.previewInput = preview ?? this.inputs[1]?.id ?? this.inputs[0]?.id ?? 1;
  }

  setProgram(source) {
    if (this.programInput === source) return false;
    this.programInput = source;
    this.emit('program', source);
    this.emit('change');
    return true;
  }

  setPreview(source) {
    if (this.previewInput === source) return false;
    this.previewInput = source;
    this.emit('preview', source);
    this.emit('change');
    return true;
  }

  /** All source ids that may carry tally (configured inputs ∪ current program/preview). */
  tallySources() {
    const ids = new Set(this.inputs.map((i) => i.id));
    ids.add(this.programInput);
    ids.add(this.previewInput);
    return [...ids].sort((a, b) => a - b);
  }

  /** [{ source, value }] tally bitfield per source (bit0 program, bit1 preview). */
  tally() {
    return this.tallySources().map((source) => {
      let value = 0;
      if (source === this.programInput) value |= TALLY_PROGRAM;
      if (source === this.previewInput) value |= TALLY_PREVIEW;
      return { source, value };
    });
  }

  /** Plain snapshot for the web/console visualizers. */
  snapshot() {
    const tallyMap = new Map(this.tally().map((t) => [t.source, t.value]));
    return {
      programInput: this.programInput,
      previewInput: this.previewInput,
      inputs: this.inputs.map((i) => ({
        id: i.id,
        longName: i.longName ?? `Camera ${i.id}`,
        shortName: i.shortName ?? `Cam${i.id}`,
        program: ((tallyMap.get(i.id) ?? 0) & TALLY_PROGRAM) !== 0,
        preview: ((tallyMap.get(i.id) ?? 0) & TALLY_PREVIEW) !== 0,
      })),
    };
  }
}
