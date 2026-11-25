"""A single macOS Printer Setup window. Worker, printing and journals remain in bridge.py."""
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog
from pathlib import Path

import bridge


class SetupWindow:
    def __init__(self, actions):
        self.actions = actions
        self.root = tk.Tk()
        self.root.title(actions.APP)
        self.root.minsize(540, 490)
        self.root.geometry("590x525")
        self.root.protocol("WM_DELETE_WINDOW", lambda: self.show("Wait for this step to finish.") if self.busy else self.root.destroy())
        self.content = ttk.Frame(self.root, padding=23)
        self.content.pack(fill="both", expand=True)
        ttk.Label(self.content, text="Printer Setup", font=("Helvetica", 22, "bold")).pack(anchor="w")
        ttk.Label(self.content, text=f"FeedX {actions.ENVIRONMENT} · Bridge v{actions.VERSION}").pack(anchor="w")
        self.steps = ttk.Label(self.content, pady=12)
        self.steps.pack(anchor="w")
        self.body = ttk.Frame(self.content)
        self.body.pack(fill="both", expand=True)
        self.status = ttk.Label(self.content, wraplength=490, justify="left")
        self.status.pack(anchor="w", fill="x", pady=(10, 0))
        self.config = bridge.load(bridge.CONFIG) or {}
        self.session = None
        self.report = None
        self.printers = {}
        self.jobs = queue.Queue()
        self.busy = False
        self.editing = not bool(self.config.get("printer"))
        self.status_text = ""
        self.draw()
        self.root.after(80, self.consume)
        if self.config.get("printer"):
            self.run(self.actions.resume, self.show_connection, "Checking this printer…", self.config)
        self.root.mainloop()

    def run(self, fn, callback, message, *args):
        if self.busy:
            return
        self.busy = True
        self.status_text = message
        for control in self.body.winfo_children():
            if isinstance(control, ttk.Button):
                control.state(["disabled"])
        self.status.configure(text=message)
        def run_job():
            try:
                self.jobs.put((callback, fn(*args), None))
            except Exception as error:
                self.actions.store_setup_issue(fn.__name__, error)
                self.jobs.put((callback, None, error))
        threading.Thread(target=run_job, daemon=False).start()

    def consume(self):
        try:
            callback, result, error = self.jobs.get_nowait()
            self.busy = False
            if error:
                self.status_text = self.actions.safe_issue(error)
            else:
                self.status_text = ""
                callback(result)
            self.draw()
        except queue.Empty:
            pass
        self.root.after(80, self.consume)

    def button(self, text, action):
        ttk.Button(self.body, text=text, command=action).pack(anchor="w", pady=3)

    def draw(self):
        for child in self.body.winfo_children():
            child.destroy()
        self.status.configure(text=self.status_text)
        configured = bool(self.config.get("printer"))
        verified = bool(self.report and self.report.get("reported") and self.report.get("available"))
        if not self.config.get("owner"):
            phase = "Authorize"
        elif configured and not self.editing and bridge.CALIBRATION.exists():
            phase = "Test Print"
        elif self.editing or not configured or not verified:
            phase = "Connect Printer"
        elif bridge.calibration_status(self.config) != "Passed":
            phase = "Test Print"
        else:
            phase = "Ready"
        self.steps.configure(text="   ·   ".join(
            f"▸ {step}" if step == phase else step for step in
            ("Install", "Authorize", "Connect Printer", "Test Print", "Ready")
        ))
        ttk.Label(self.body, text=phase, font=("Helvetica", 16, "bold")).pack(anchor="w", pady=(0, 5))
        if phase == "Authorize":
            self.button("Authorize in browser", self.authorize)
        elif self.editing or not configured:
            self.draw_configuration()
        else:
            ttk.Label(self.body, text=self.config["printer"]).pack(anchor="w", pady=(0, 6))
            if phase == "Test Print":
                pending = bridge.load(bridge.CALIBRATION)
                if pending:
                    ttk.Label(self.body, text=f"Inspect {pending['quantity']} test label(s) and clear any held output.").pack(anchor="w")
                    self.button("All printed correctly", lambda: self.test("PASSED"))
                    self.button("Inspected · Record issue", lambda: self.test("INSPECTED"))
                else:
                    armed = tk.BooleanVar()
                    copies = 3 if self.config["transport"] == "tspl" and self.config.get("calibrated_labels") == 1 else 1
                    ttk.Checkbutton(self.body, text="Printer idle, correct stock loaded, no pending output",
                                    variable=armed).pack(anchor="w")
                    self.button(f"Send {copies} TEST label(s)", lambda: self.test(None) if armed.get() else self.show("Confirm the stock and printer are ready."))
            elif phase == "Ready":
                ttk.Label(self.body, text="Connection verified · Calibration passed").pack(anchor="w")
                self.button("Open FeedX", self.actions.open_feedx)
            else:
                self.button("Reconnect", lambda: self.run(self.actions.wait_for_connection, self.show_connection,
                                                           "Checking this printer…", self.config))
            self.button("Change printer or stock", self.edit)
            self.button("Authorize again", self.authorize)
        self.button("Troubleshooting", self.troubleshoot)

    def show(self, message):
        self.status_text = message
        self.status.configure(text=message)

    def authorize(self):
        self.run(self.actions.authorize, self.authorized, "Complete authorization in your browser…", self.config)

    def authorized(self, result):
        self.config, self.session = result
        if self.config.get("printer"):
            self.report = None
            self.run(self.actions.save_authorization, self.connected, "Saving authorization…", self.config, self.session)
        else:
            self.edit()

    def edit(self):
        self.editing = True
        self.run(self.actions.discover, self.discovered, "Discovering printers…")

    def discovered(self, printers):
        self.printers = printers

    def draw_configuration(self):
        form = ttk.Frame(self.body)
        form.pack(fill="x", pady=4)
        form.columnconfigure(1, weight=1)
        prior = next((key for key, value in self.printers.items()
                      if value == (self.config.get("printer"), self.config.get("bluetooth_address"))), "")
        chosen = tk.StringVar(value=prior or (next(iter(self.printers)) if len(self.printers) == 1 else ""))
        ttk.Label(form, text="Printer").grid(row=0, column=0, sticky="w")
        ttk.Combobox(form, state="readonly", textvariable=chosen,
                     values=tuple(self.printers)).grid(row=0, column=1, columnspan=3, sticky="ew", padx=5)
        fields = []
        for index, (label, key, default) in enumerate((("Width (mm)", "stock_width", 80),
                ("Length (mm)", "stock_height", 90), ("Gap (mm)", "gap", 2)), start=1):
            ttk.Label(form, text=label).grid(row=index, column=0, sticky="w", pady=3)
            field = tk.StringVar(value=str(self.config.get(key, default)))
            ttk.Entry(form, textvariable=field, width=12).grid(row=index, column=1, sticky="w", padx=5)
            fields.append(field)
        self.button("Rescan printers", self.edit)
        def connect():
            if chosen.get() not in self.printers:
                self.show("Pair the D520 or install a CUPS queue, then rescan.")
                return
            self.run(self.actions.configure_and_check, self.connected, "Saving printer and checking connection…",
                     self.config, self.session, self.printers[chosen.get()], [field.get() for field in fields])
        self.button("Connect Printer", connect)

    def connected(self, result):
        self.config, self.report = result
        self.session = None
        self.editing = False
        self.show_connection(self.report)

    def show_connection(self, result):
        self.report = result
        if not result.get("available"):
            self.status_text = result.get("detail") or "Printer unavailable."
        elif result.get("held"):
            self.status_text = "Review pending Job Order output in FeedX."

    def test(self, review):
        self.run(self.actions.calibrate, self.tested, "Updating calibration…", self.config, review)

    def tested(self, result):
        self.config = result
        self.run(self.actions.wait_for_connection, self.show_connection, "Refreshing printer status…", self.config)

    def troubleshoot(self):
        if self.busy:
            return
        filename = filedialog.asksaveasfilename(defaultextension=".json", initialfile="FeedX-Bridge-Diagnostics.json")
        if not filename:
            return
        try:
            self.actions.export_setup_issue(Path(filename))
            self.show("Diagnostics saved.")
        except OSError:
            self.show("Could not save diagnostics. Choose a writable folder.")
