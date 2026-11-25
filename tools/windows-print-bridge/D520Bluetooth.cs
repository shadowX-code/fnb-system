using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FeedXD520Bluetooth {
    const int AfBluetooth = 32, Rfcomm = 3, WouldBlock = 10035;
    static readonly Guid SerialPortService = new Guid("00001101-0000-1000-8000-00805f9b34fb");
    static readonly byte[] ModeQuery = Encoding.ASCII.GetBytes("SSSGETBMAPMODE\r\n");
    static readonly byte[] Mode4 = Encoding.ASCII.GetBytes("SSSGETBMAPMODE:4\r\n");
    static readonly byte[] Ack = { 0x7e, 0x01, 0x7e }, Nak = { 0x7e, 0x00, 0x7e };

    [StructLayout(LayoutKind.Sequential)]
    struct DeviceSearch {
        public uint Size;
        public int Authenticated, Remembered, Unknown, Connected, Inquiry;
        public byte Timeout;
        public IntPtr Radio;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DeviceInfo {
        public uint Size;
        public ulong Address;
        public uint Class;
        public int Connected, Remembered, Authenticated;
        public SystemTime LastSeen, LastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SystemTime { public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds; }

    // ws2bth.h uses a packed 30-byte sockaddr for RFCOMM on both Windows architectures.
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct BluetoothAddress {
        public ushort Family;
        public ulong Address;
        public Guid Service;
        public uint Port;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SocketSet { public uint Count; public IntPtr Socket; }

    [StructLayout(LayoutKind.Sequential)]
    struct TimeVal { public int Seconds, Microseconds; }

    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern IntPtr BluetoothFindFirstDevice(ref DeviceSearch search, ref DeviceInfo device);
    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern bool BluetoothFindNextDevice(IntPtr search, ref DeviceInfo device);
    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern bool BluetoothFindDeviceClose(IntPtr search);
    [DllImport("ws2_32.dll")] static extern int WSAStartup(ushort version, [Out] byte[] data);
    [DllImport("ws2_32.dll")] static extern int WSACleanup();
    [DllImport("ws2_32.dll")] static extern int WSAGetLastError();
    [DllImport("ws2_32.dll")] static extern IntPtr socket(int family, int type, int protocol);
    [DllImport("ws2_32.dll")] static extern int closesocket(IntPtr handle);
    [DllImport("ws2_32.dll")] static extern int connect(IntPtr handle, ref BluetoothAddress address, int length);
    [DllImport("ws2_32.dll")] static extern int ioctlsocket(IntPtr handle, uint command, ref uint value);
    [DllImport("ws2_32.dll")] static extern int setsockopt(IntPtr handle, int level, int name, ref int value, int length);
    [DllImport("ws2_32.dll")] static extern int getsockopt(IntPtr handle, int level, int name, out int value, ref int length);
    [DllImport("ws2_32.dll")] static extern int select(int ignored, ref SocketSet read, ref SocketSet write, ref SocketSet errors, ref TimeVal timeout);
    [DllImport("ws2_32.dll")] static extern int send(IntPtr handle, byte[] data, int length, int flags);
    [DllImport("ws2_32.dll")] static extern int recv(IntPtr handle, [Out] byte[] data, int length, int flags);

    public static string[] Discover() {
        var result = new HashSet<string>(StringComparer.Ordinal);
        var search = new DeviceSearch { Size = (uint)Marshal.SizeOf(typeof(DeviceSearch)), Authenticated = 1 };
        var device = new DeviceInfo { Size = (uint)Marshal.SizeOf(typeof(DeviceInfo)) };
        IntPtr handle = BluetoothFindFirstDevice(ref search, ref device);
        if (handle == IntPtr.Zero) return new string[0];
        try {
            do {
                if (device.Authenticated != 0 &&
                    (String.Equals(device.Name, "D520", StringComparison.OrdinalIgnoreCase) ||
                     String.Equals(device.Name, "D520BT", StringComparison.OrdinalIgnoreCase) ||
                     String.Equals(device.Name, "D520-BT", StringComparison.OrdinalIgnoreCase) ||
                     String.Equals(device.Name, "D520(BT)", StringComparison.OrdinalIgnoreCase))) {
                    if (device.Address != 0 && device.Address <= 0xFFFFFFFFFFFFul)
                        result.Add(device.Address.ToString("X12", CultureInfo.InvariantCulture));
                }
            } while (BluetoothFindNextDevice(handle, ref device));
        } finally { BluetoothFindDeviceClose(handle); }
        var addresses = new string[result.Count];
        result.CopyTo(addresses);
        Array.Sort(addresses, StringComparer.Ordinal);
        return addresses;
    }

    static IOException SocketError(string action) {
        return new IOException(action + " (Windows Bluetooth error " + WSAGetLastError() + ").");
    }

    static bool Wait(IntPtr handle, bool reading, int milliseconds) {
        if (milliseconds <= 0) return false;
        var active = new SocketSet { Count = 1, Socket = handle };
        var empty = new SocketSet();
        var errors = active;
        var timeout = new TimeVal { Seconds = milliseconds / 1000, Microseconds = (milliseconds % 1000) * 1000 };
        int result = reading ? select(0, ref active, ref empty, ref errors, ref timeout)
                             : select(0, ref empty, ref active, ref errors, ref timeout);
        if (result < 0) throw SocketError("D520 connection wait failed");
        return result > 0;
    }

    static void Write(IntPtr handle, byte[] payload, int timeout) {
        var timer = Stopwatch.StartNew();
        var buffer = new byte[1024];
        for (int offset = 0; offset < payload.Length;) {
            if (!Wait(handle, false, timeout - (int)timer.ElapsedMilliseconds))
                throw new IOException("D520 Bluetooth write timed out.");
            int count = Math.Min(buffer.Length, payload.Length - offset);
            Buffer.BlockCopy(payload, offset, buffer, 0, count);
            int sent = send(handle, buffer, count, 0);
            if (sent < 0 && WSAGetLastError() == WouldBlock) continue;
            if (sent <= 0) throw SocketError("D520 Bluetooth write failed");
            offset += sent;
        }
    }

    static bool Contains(byte[] buffer, int length, byte[] token) {
        for (int offset = 0; offset <= length - token.Length; offset++) {
            int i = 0;
            while (i < token.Length && buffer[offset + i] == token[i]) i++;
            if (i == token.Length) return true;
        }
        return false;
    }

    public static int Receipt(byte[] buffer, int length) {
        if (Contains(buffer, length, Nak)) return -1;
        return Contains(buffer, length, Ack) ? 1 : 0;
    }

    static int ReadReply(IntPtr handle, bool modeCheck) {
        var timer = Stopwatch.StartNew();
        var accumulated = new byte[4096];
        var chunk = new byte[256];
        int length = 0;
        while (length < accumulated.Length && Wait(handle, true, 4000 - (int)timer.ElapsedMilliseconds)) {
            int count = recv(handle, chunk, Math.Min(chunk.Length, accumulated.Length - length), 0);
            if (count < 0 && WSAGetLastError() == WouldBlock) continue;
            if (count <= 0) break;
            Buffer.BlockCopy(chunk, 0, accumulated, length, count);
            length += count;
            int result = modeCheck ? (Contains(accumulated, length, Mode4) ? 1 : 0) : Receipt(accumulated, length);
            if (result != 0) return result;
        }
        return 0;
    }

    public static void Probe(string address) { Exchange(address, null); }

    public static void Submit(string address, byte[] payload) {
        if (payload == null || payload.Length == 0 || payload.Length >= 210000)
            throw new ArgumentException("Invalid D520 label payload length.");
        Exchange(address, payload);
    }

    static void Exchange(string address, byte[] payload) {
        ulong target;
        if (address == null || address.Length != 12 || !UInt64.TryParse(address, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out target))
            throw new ArgumentException("Select a paired D520 in Bridge Setup.");
        address = target.ToString("X12", CultureInfo.InvariantCulture);
        using (var gate = new Mutex(false, @"Local\FeedX-D520-RFCOMM-" + address)) {
            bool held;
            try { held = gate.WaitOne(0); }
            catch (AbandonedMutexException) { held = true; }
            if (!held) throw new IOException("The Bridge is already using this D520 connection.");
            try {
                if (Array.IndexOf(Discover(), address) < 0) throw new IOException("Pair the D520 in Windows Bluetooth settings.");
                OpenAndExchange(target, payload);
            } finally { gate.ReleaseMutex(); }
        }
    }

    static void OpenAndExchange(ulong target, byte[] payload) {
        int startup = WSAStartup(0x0202, new byte[512]);
        if (startup != 0) throw new IOException("Windows Bluetooth sockets are unavailable (" + startup + ").");
        var invalid = new IntPtr(-1);
        var handle = invalid;
        try {
            handle = socket(AfBluetooth, 1, Rfcomm);
            if (handle == invalid) throw SocketError("Windows Classic Bluetooth is unavailable");
            uint nonblocking = 1;
            if (ioctlsocket(handle, 0x8004667e, ref nonblocking) != 0) throw SocketError("D520 socket setup failed");
            int authenticate = 1;
            if (setsockopt(handle, Rfcomm, unchecked((int)0x80000001), ref authenticate, 4) != 0)
                throw SocketError("D520 paired authentication setup failed");
            var endpoint = new BluetoothAddress { Family = AfBluetooth, Address = target, Service = SerialPortService };
            if (connect(handle, ref endpoint, Marshal.SizeOf(typeof(BluetoothAddress))) != 0) {
                if (WSAGetLastError() != WouldBlock) throw SocketError("D520 serial connection failed");
                if (!Wait(handle, false, 8000)) throw new IOException("D520 serial connection timed out. Check power, range and other printer apps.");
                int length = 4, error;
                if (getsockopt(handle, 0xffff, 0x1007, out error, ref length) != 0) throw SocketError("D520 serial connection failed");
                if (error != 0) throw new IOException("D520 serial connection failed (Windows Bluetooth error " + error + ").");
            }
            Write(handle, ModeQuery, 2000);
            if (ReadReply(handle, true) != 1) throw new IOException("D520 did not confirm Bluetooth bitmap mode 4.");
            if (payload == null) return;
            Write(handle, payload, 30000);
            int receipt = ReadReply(handle, false);
            if (receipt != 1) throw new IOException(receipt < 0 ? "D520 rejected the submission." : "D520 did not acknowledge the submission.");
        } finally {
            if (handle != invalid) closesocket(handle);
            WSACleanup();
        }
    }
}
