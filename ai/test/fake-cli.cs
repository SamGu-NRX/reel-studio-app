// A stand-in for a command-line tool the app runs, for the tests on Windows (fake-cli.ts builds it). Windows starts
// only a real .exe without a shell, so the shell-script stand-ins used on macOS and Linux can't run there.
// It reads <its own name>.txt beside it:
//   line 1: a file to append this run's arguments to, joined by spaces (empty: none)
//   line 2: seconds to sleep instead of answering, without reading stdin (0: answer)
//   rest:   what to print once stdin has closed
using System;
using System.IO;
using System.Text;
using System.Threading;

static class FakeCli
{
    static int Main(string[] args)
    {
        string exe = System.Reflection.Assembly.GetEntryAssembly().Location;
        string[] cfg = File.ReadAllText(Path.ChangeExtension(exe, ".txt"), Encoding.UTF8).Split(new[] { '\n' }, 3);
        if (cfg.Length < 3) { Console.Error.WriteLine("fake-cli: " + Path.ChangeExtension(exe, ".txt") + " needs three parts"); return 2; }
        UTF8Encoding utf8 = new UTF8Encoding(false);
        if (cfg[0].Length > 0) File.AppendAllText(cfg[0], string.Join(" ", args) + "\n", utf8);
        int sleep = int.Parse(cfg[1]);
        if (sleep > 0) { Thread.Sleep(sleep * 1000); return 0; }
        Console.OpenStandardInput().CopyTo(Stream.Null);
        if (cfg[2].Length > 0)
        {
            byte[] b = utf8.GetBytes(cfg[2] + "\n");
            Stream o = Console.OpenStandardOutput();
            o.Write(b, 0, b.Length);
            o.Flush();
        }
        return 0;
    }
}
