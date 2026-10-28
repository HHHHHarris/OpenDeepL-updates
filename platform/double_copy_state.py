"""Pure key/clipboard-metadata state for passive double-copy detection."""


class DoubleCopyState:
    def __init__(self, interval=0.6, copy_timeout=0.35):
        self.interval = interval
        self.copy_timeout = copy_timeout
        self.reset()

    def reset(self):
        self.stage = 0
        self.held = False
        self.pending = False
        self.copied = False
        self.baseline = None
        self.deadline = 0.0
        self.last_down = None
        self.suppressed = False
        self.trigger_sequence = None
        self.emitted = False
        self.context = None

    def interrupt(self):
        self.reset()

    def key_up(self, context=None):
        self.held = False
        if context != self.context:
            self.reset()
            return False
        return self._trigger_if_ready()

    def _trigger_if_ready(self):
        if self.stage == 2 and self.copied and not self.held and not self.emitted:
            self.emitted = True
            self.suppressed = True
            return True
        return False

    def key_down(self, now, sequence, modifiers_valid=True, repeat=False, context=None):
        """Register a physical C-down; never handles or suppresses the event."""
        if not modifiers_valid:
            self.reset()
            return
        if self.held or repeat:
            return
        self.held = True
        if self.suppressed:
            if self.last_down is not None and now - self.last_down <= self.interval:
                self.last_down = now
                return
            self.reset()
            self.held = True
        if self.stage == 1:
            # A copy may have completed between the last poll and this keydown.
            if self.pending and now <= self.deadline and sequence != self.baseline:
                self.pending = False
                self.copied = True
            if (self.last_down is not None and now - self.last_down > self.interval
                    or context != self.context):
                self.reset()
                self.held = True
                self.stage = 1
            elif not self.copied:
                # An unconfirmed first copy cannot become a valid pair later.
                self.suppressed = True
                self.last_down = now
                self.pending = False
                return
            else:
                self.stage = 2
        else:
            self.stage = 1
        self.last_down = now
        self.baseline = sequence
        self.deadline = now + self.copy_timeout
        self.pending = True
        self.copied = False
        self.context = context

    def observe(self, now, sequence, context=None):
        """Return True exactly once for a confirmed pair of sequence changes."""
        if not self.pending:
            return False
        if context != self.context:
            self.reset()
            return False
        if now > self.deadline:
            self.pending = False
            self.copied = False
            return False
        if sequence == self.baseline:
            return False
        self.pending = False
        self.copied = True
        if self.stage == 2:
            self.trigger_sequence = sequence
            return self._trigger_if_ready()
        return False
