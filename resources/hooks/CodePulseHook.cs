using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

internal static class CodePulseHook
{
    private const int MaxInputLength = 2 * 1024 * 1024;

    [STAThread]
    private static int Main(string[] args)
    {
        string eventName = null;
        try
        {
            Forward(args, out eventName);
        }
        catch (Exception error)
        {
            // Monitoring must never interrupt a Codex task.
            if (Array.IndexOf(args, "--diagnostic") >= 0) Console.Error.WriteLine(error);
        }

        WriteHookOutput(eventName);

        return 0;
    }

    private static void Forward(string[] args, out string eventName)
    {
        eventName = null;
        string token = ArgumentValue(args, "--token");
        if (!IsToken(token)) return;

        string raw = ReadStandardInput();
        if (String.IsNullOrWhiteSpace(raw)) return;

        JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = MaxInputLength };
        Dictionary<string, object> input = serializer.Deserialize<Dictionary<string, object>>(raw);
        if (input == null) return;

        eventName = StringValue(input, "hook_event_name");
        string sessionId = StringValue(input, "session_id");
        if (String.IsNullOrEmpty(eventName) || String.IsNullOrEmpty(sessionId)) return;

        Dictionary<string, object> payload = new Dictionary<string, object>
        {
            { "hook_event_name", eventName },
            { "session_id", sessionId },
            { "cwd", StringValue(input, "cwd") },
            { "tool_name", StringValue(input, "tool_name") },
            { "runtime", ArgumentValue(args, "--runtime") == "wsl" ? "wsl" : "windows" },
            { "distro", ArgumentValue(args, "--distro") ?? String.Empty }
        };

        int port = 17322;
        int diagnosticPort;
        if (Array.IndexOf(args, "--diagnostic") >= 0 &&
            Int32.TryParse(ArgumentValue(args, "--port"), out diagnosticPort) &&
            diagnosticPort > 0 && diagnosticPort <= 65535)
        {
            port = diagnosticPort;
        }

        byte[] body = Encoding.UTF8.GetBytes(serializer.Serialize(payload));
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/activity");
        request.Method = "POST";
        request.ContentType = "application/json";
        request.ContentLength = body.Length;
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
        request.KeepAlive = false;
        request.Proxy = null;
        request.Timeout = 1200;
        request.ReadWriteTimeout = 1200;

        using (Stream stream = request.GetRequestStream())
        {
            stream.Write(body, 0, body.Length);
        }

        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        {
            // Waiting for the response guarantees that CodePulse accepted the event.
        }
    }

    private static void WriteHookOutput(string eventName)
    {
        if (eventName != "Stop" && eventName != "SubagentStop") return;
        using (StreamWriter writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)))
        {
            writer.Write("{}");
            writer.Flush();
        }
    }

    private static string ReadStandardInput()
    {
        using (StreamReader reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8, true, 4096))
        {
            char[] buffer = new char[4096];
            StringBuilder value = new StringBuilder();
            int count;
            while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (value.Length + count > MaxInputLength) return String.Empty;
                value.Append(buffer, 0, count);
            }
            return value.ToString();
        }
    }

    private static string ArgumentValue(string[] args, string name)
    {
        for (int index = 0; index + 1 < args.Length; index++)
        {
            if (args[index] == name) return args[index + 1];
        }
        return null;
    }

    private static string StringValue(Dictionary<string, object> input, string name)
    {
        object value;
        return input.TryGetValue(name, out value) && value is string ? (string)value : String.Empty;
    }

    private static bool IsToken(string token)
    {
        if (String.IsNullOrEmpty(token) || token.Length != 64) return false;
        foreach (char value in token)
        {
            bool hexadecimal = (value >= '0' && value <= '9') ||
                               (value >= 'a' && value <= 'f') ||
                               (value >= 'A' && value <= 'F');
            if (!hexadecimal) return false;
        }
        return true;
    }

}
