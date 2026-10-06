// Shared UI state: SHIFT can come from the keyboard, the on-screen (latching) button, or MIDI.
export const ui = {
  keyShift: false,
  latch: [false, false],
  midiShift: [false, false],
  listeners: new Set(),
  isShift(i) {
    return this.keyShift || this.latch[i] || this.midiShift[i];
  },
  // A latched on-screen SHIFT applies to one action, then releases
  consume(i) {
    if (this.latch[i]) {
      this.latch[i] = false;
      this.emit();
    }
  },
  emit() {
    for (const fn of this.listeners) fn();
  },
};
