using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

public sealed class FeedXBrowserAuthorization : IDisposable {
    readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
    readonly string nonce;
    readonly string page;
    readonly string origin;
    public string Url { get; private set; }

    public FeedXBrowserAuthorization(string template, string key, string authOrigin, string environment) {
        if (!Regex.IsMatch(key, @"^[A-Za-z0-9_.-]{10,550}$") ||
            !Regex.IsMatch(authOrigin, @"^https://[a-z0-9]+\.supabase\.co$") ||
            !Regex.IsMatch(environment, @"^(Staging|Production)$"))
            throw new ArgumentException("Invalid FeedX sign-in configuration.");
        origin = authOrigin;
        var random = new byte[32];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(random);
        nonce = BitConverter.ToString(random).Replace("-", "").ToLowerInvariant();
        page = template.Replace("__NONCE__", nonce).Replace("__CLIENT_KEY__", key)
            .Replace("__AUTH_ORIGIN__", authOrigin).Replace("__ENVIRONMENT__", environment);
        listener.Start(4);
        Url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    public string LaunchUrl { get { return Url + "/authorize/" + nonce; } }

    public string Poll() {
        if (!listener.Pending()) return null;
        using (var client = listener.AcceptTcpClient()) {
            client.ReceiveTimeout = 1200;
            client.SendTimeout = 1200;
            try { return Handle(client.GetStream()); }
            catch (IOException) { return null; }
        }
    }

    string Handle(Stream stream) {
        var headers = new List<byte>();
        var elapsed = Stopwatch.StartNew();
        while (headers.Count < 8192 && elapsed.ElapsedMilliseconds < 1800) {
            int next = stream.ReadByte();
            if (next < 0) return null;
            headers.Add((byte)next);
            int size = headers.Count;
            if (size >= 4 && headers[size-4] == 13 && headers[size-3] == 10 &&
                headers[size-2] == 13 && headers[size-1] == 10) break;
        }
        if (elapsed.ElapsedMilliseconds >= 1800 || headers.Count >= 8192) return null;
        var lines = Encoding.ASCII.GetString(headers.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
        var request = lines[0].Split(' ');
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 1; i < lines.Length && lines[i].Length > 0; i++) {
            int separator = lines[i].IndexOf(':');
            if (separator < 1 || values.ContainsKey(lines[i].Substring(0, separator))) return null;
            values.Add(lines[i].Substring(0, separator), lines[i].Substring(separator + 1).Trim());
        }
        string host, origin, contentType, lengthValue;
        int length;
        if (request.Length != 3 || !values.TryGetValue("Host", out host) || "http://" + host != Url) return null;
        if (request[0] == "GET" && request[1] == "/authorize/" + nonce) {
            Reply(stream, 200, page);
        } else if (request[0] == "POST" && request[1] == "/session/" + nonce &&
            values.TryGetValue("Origin", out origin) && origin == Url &&
            values.TryGetValue("Content-Type", out contentType) && contentType == "application/json" &&
            !values.ContainsKey("Transfer-Encoding") && values.TryGetValue("Content-Length", out lengthValue) &&
            Int32.TryParse(lengthValue, out length) && length > 0 && length <= 32768) {
            var body = new byte[length];
            for (int offset = 0; offset < body.Length;) {
                if (elapsed.ElapsedMilliseconds >= 2500) return null;
                int count = stream.Read(body, offset, body.Length - offset);
                if (count == 0) return null;
                offset += count;
            }
            Reply(stream, 200, "{}");
            return Encoding.UTF8.GetString(body);
        } else { Reply(stream, 404, "Authorization not found."); }
        return null;
    }

    void Reply(Stream stream, int status, string content) {
        var data = Encoding.UTF8.GetBytes(content);
        var headers = "HTTP/1.1 " + (status == 200 ? "200 OK" : "404 Not Found") +
            "\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + data.Length +
            "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff" +
            "\r\nContent-Security-Policy: default-src 'none'; script-src 'nonce-" + nonce +
            "'; style-src 'nonce-" + nonce + "'; connect-src 'self' " + origin +
            "; frame-ancestors 'none'; form-action 'none'; base-uri 'none'\r\n\r\n";
        var encoded = Encoding.ASCII.GetBytes(headers);
        stream.Write(encoded, 0, encoded.Length);
        stream.Write(data, 0, data.Length);
    }

    public void Dispose() { listener.Stop(); }
}
