// The host-facing view of a device: identity + capabilities + live property values + a stream path for
// cameras. This is the shape the WS `devices.list` / `device.state` / `device.properties` commands and
// the go2rtc camera registration both read.
//
// IMPORTANT:
// Some newer/non-video Eufy devices are currently misclassified by the SDK as codec="camera" and are
// therefore given "camera"/"video" capabilities. Those false capabilities must not be allowed to create
// go2rtc streams, because doing so can cause unnecessary P2P activity.
//
// This bridge-level denylist is intentionally conservative. It prevents known non-video product models
// from receiving a stream while leaving the SDK-reported capabilities/properties untouched.

const NON_VIDEO_MODELS = new Set([
  "T87B2", // SmartTrack Card
  "T9000", // HomeBase Professional S1
  "T90F0", // Flood & Freeze Sensor
  "T90G0", // Glass Break Sensor
  "T90K0", // Key Fob
  "T90P0", // Panic Button
  "T90S0", // Smoke Alarm / Smoke Sensor
]);

export function createDeviceView(ctx) {
  const { eufy } = ctx;
  const { streaming } = ctx.state;

  /**
   * Build the host-facing summary of one device: identity + capabilities + a stream path for a camera.
   *
   * `name` is the owner's device name (falling back to the product name when unnamed), `model` is the
   * T-code, `modelName` is the product. A host shows `name` as the device name and `model`/`modelName`
   * as its model — no cross-referencing the device list.
   */
  async function describeDevice(sn) {
    const dev = await eufy.getDevice(sn);
    const m = dev.describe();

    const hasCameraCapability = m.capabilities.includes("camera");
    const hasVideoCapability = m.capabilities.includes("video");

    const sdkSaysCamera = hasCameraCapability || hasVideoCapability;

    const model = m.model || m.modelName;
    const knownNonVideoDevice = NON_VIDEO_MODELS.has(model);

    // A stream is created only when the SDK reports camera/video capability AND
    // the hardware model is not one of the known non-video devices.
    const isCamera = sdkSaysCamera && !knownNonVideoDevice;

    console.log(
      `[bridge:device-classification] ` +
        `sn=${m.sn} ` +
        `name=${JSON.stringify(m.name)} ` +
        `model=${JSON.stringify(model)} ` +
        `modelName=${JSON.stringify(m.modelName)} ` +
        `codec=${JSON.stringify(m.codec)} ` +
        `cameraCap=${hasCameraCapability} ` +
        `videoCap=${hasVideoCapability} ` +
        `knownNonVideo=${knownNonVideoDevice} ` +
        `streamEligible=${isCamera} ` +
        `capabilities=${JSON.stringify(m.capabilities)}`,
    );

    if (sdkSaysCamera && knownNonVideoDevice) {
      console.warn(
        `[bridge:stream-guard] ` +
          `blocked false camera stream ` +
          `sn=${m.sn} ` +
          `name=${JSON.stringify(m.name)} ` +
          `model=${JSON.stringify(model)} ` +
          `codec=${JSON.stringify(m.codec)}`,
      );
    }

    // Temporary diagnostic:
    // Dump the complete property manifest and current property values for devices
    // that advertise the SDK "arming" capability. This lets us determine how
    // guard mode/current mode should map to Home Assistant's alarm_control_panel.
    if (m.capabilities.includes("arming")) {
      const specs = propertySpecs(dev);
      const state = propertyState(dev);

      console.log(
        `[bridge:arming-diagnostic] ` +
          `sn=${m.sn} ` +
          `name=${JSON.stringify(m.name)} ` +
          `model=${JSON.stringify(model)} ` +
          `codec=${JSON.stringify(m.codec)} ` +
          `properties=${JSON.stringify(specs)} ` +
          `state=${JSON.stringify(state)}`,
      );
    }

    return {
      sn: m.sn,
      name: m.name, // owner's device name (e.g. "Dining room"), from device_name
      model, // T-code (e.g. "T8410"); product name as fallback
      modelName: m.modelName, // product display name (e.g. "Indoor Cam Pan & Tilt")
      codec: m.codec,
      capabilities: m.capabilities,
      state: propertyState(dev), // live property values ({ battery: 74, motion: false, … })
      stream: isCamera ? `/stream/${m.sn}` : undefined,
      streaming: isCamera ? streaming.has(m.sn) : undefined, // live P2P feed active right now?
      canReboot: m.codec === "station", // HomeBase-only; drives a Reboot button in HA
    };
  }

  /** Live property values as a flat `{ name: value }` map (reading schedules a background refresh). */
  function propertyState(dev) {
    const out = {};
    for (const [name, pv] of Object.entries(dev.getProperties())) {
      out[name] = pv.value;
    }
    return out;
  }

  /**
   * The device's property manifest — the host-relevant half of each PropertySpec, so a frontend can
   * build the right entity (writable bool → switch, enum → select, number → number, else sensor)
   * without knowing eufy wire ids. Wire-only fields (paramType, decode, aliases) are omitted.
   */
  function propertySpecs(dev) {
    return (dev.properties ?? []).map((p) => ({
      name: p.name,
      type: p.type, // "bool" | "number" | "string" | "enum"
      unit: p.unit, // "%", "°C", "dBm", …
      kind: p.kind, // percent | celsius | dbm | seconds | …
      writable: p.writable, // a setter exists (device.set accepts it)
      enumValues: p.enumValues, // { raw: label } for enums
      description: p.description,
    }));
  }

  async function deviceList() {
    const devices = await eufy.getDevices();

    return Promise.all(
      devices.map((d) =>
        describeDevice(d.sn).catch((e) => ({
          sn: d.sn,
          error: String(e?.message ?? e),
        })),
      ),
    );
  }

  return {
    describeDevice,
    propertyState,
    propertySpecs,
    deviceList,
  };
}
