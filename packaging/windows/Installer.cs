using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using Microsoft.Win32;

class Program
{
    const string Magic = "WXSFX001";
    const string AppVersion = "0.5.1";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WeChatGirl";
    const string LegacyUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WeChatAgent";

    static int Main(string[] args)
    {
        bool check = false;
        foreach (string a in args) { if (a == "--check") check = true; }
        try
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            long len = new FileInfo(self).Length;
            if (len < 16) throw new Exception("安装包不完整。");
            byte[] ft = new byte[16];
            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read))
            {
                fs.Seek(len - 16, SeekOrigin.Begin);
                fs.Read(ft, 0, 16);
            }
            long zipLen = BitConverter.ToInt64(ft, 0);
            string magic = Encoding.ASCII.GetString(ft, 8, 8);
            if (magic != Magic) throw new Exception("安装包损坏（找不到数据段）。");
            long zipStart = len - 16 - zipLen;
            if (zipStart < 0) throw new Exception("安装包损坏（数据段长度异常）。");

            if (check)
            {
                Console.WriteLine("OK zipLen=" + zipLen + " zipStart=" + zipStart);
                string tz = Path.Combine(Path.GetTempPath(), "wxsfx-check.zip");
                CopyRange(self, zipStart, zipLen, tz);
                using (ZipArchive za = ZipFile.OpenRead(tz))
                {
                    Console.WriteLine("entries=" + za.Entries.Count);
                    int n = 0;
                    foreach (ZipArchiveEntry e in za.Entries)
                    {
                        if (n < 5) Console.WriteLine("  " + e.FullName + " (" + e.Length + ")");
                        n++;
                        if (n >= 5) break;
                    }
                }
                File.Delete(tz);
                return 0;
            }

            string installDir = Environment.GetEnvironmentVariable("WXSFX_INSTALL_DIR");
            if (string.IsNullOrEmpty(installDir))
                installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WeChatAgent");
            bool noLaunch = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WXSFX_NO_LAUNCH"));
            bool noRegistry = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WXSFX_NO_REGISTRY"));
            bool noShortcut = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WXSFX_NO_SHORTCUT"));

            Console.WriteLine("============================================");
            Console.WriteLine("  WeChatGirl 0.5.1 安装程序");
            Console.WriteLine("  安装位置: " + installDir);
            Console.WriteLine("============================================");
            Console.WriteLine();

            string tempZip = Path.Combine(Path.GetTempPath(), "wechatgirl-0.5.1-" + Guid.NewGuid().ToString("N") + ".zip");
            Console.WriteLine("正在释放安装包...");
            CopyRange(self, zipStart, zipLen, tempZip);

            Directory.CreateDirectory(installDir);
            Console.WriteLine("正在安装 WeChatGirl 文件，请稍候...");
            int lastPct = -1;
            using (ZipArchive za = ZipFile.OpenRead(tempZip))
            {
                int total = za.Entries.Count, done = 0;
                foreach (ZipArchiveEntry e in za.Entries)
                {
                    string rel = e.FullName.Replace('/', '\\');
                    string dest = Path.Combine(installDir, rel);
                    if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\"))
                    {
                        Directory.CreateDirectory(dest);
                        continue;
                    }
                    if (File.Exists(dest) && PreserveUserFile(e.FullName)) { done++; continue; }
                    string dir = Path.GetDirectoryName(dest);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    e.ExtractToFile(dest, true);
                    done++;
                    int pct = (int)((long)done * 100 / total);
                    if (pct != lastPct)
                    {
                        lastPct = pct;
                        int fill = pct / 2;
                        Console.Write("\r  安装中 [" + new string('#', fill) + new string('-', 50 - fill) + "] " + pct.ToString().PadLeft(3) + "%");
                    }
                }
                Console.WriteLine();
                Console.WriteLine("  完成 " + total + " 个文件");
            }
            File.Delete(tempZip);

            string exePath = Path.Combine(installDir, @"app\WeChatGirl.exe");
            if (!File.Exists(exePath)) throw new Exception("安装后缺少 app\\WeChatGirl.exe。");
            CleanupLegacyFiles(installDir);

            Console.WriteLine("正在写入卸载程序...");
            WriteResource("Uninstall.exe", Path.Combine(installDir, "uninstall.exe"));

            Console.WriteLine("正在创建桌面快捷方式...");
            if (!noShortcut) { try { CreateShortcut(exePath, Path.Combine(installDir, "app")); } catch { } }

            if (!noRegistry)
            {
                Console.WriteLine("正在注册到应用列表...");
                try
                {
                    using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
                    {
                        k.SetValue("DisplayName", "WeChatGirl");
                        k.SetValue("DisplayVersion", AppVersion);
                        k.SetValue("Publisher", "my12yyds");
                        k.SetValue("InstallLocation", installDir);
                        k.SetValue("DisplayIcon", exePath);
                        k.SetValue("UninstallString", "\"" + Path.Combine(installDir, "uninstall.exe") + "\"");
                        k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                    RemoveLegacyUninstallEntry(installDir);
                }
                catch { }
            }

            if (noLaunch)
            {
                Console.WriteLine("安装完成（测试模式，未启动）。");
                return 0;
            }
            Console.WriteLine("安装完成，正在启动 WeChatGirl...");
            Process.Start(new ProcessStartInfo(exePath) { WorkingDirectory = Path.Combine(installDir, "app") });
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine();
            Console.WriteLine("安装失败: " + ex.Message);
            Console.WriteLine("按任意键退出...");
            try { Console.ReadKey(); } catch { }
            return 1;
        }
    }

    static bool PreserveUserFile(string path)
    {
        string value = path.Replace('\\', '/').ToLowerInvariant();
        return value == "app/storage.ini" || value == "data/.wechatagent-data.json" ||
            value.StartsWith("data/workspace/config/", StringComparison.Ordinal) ||
            value.StartsWith("data/workspace/roles/", StringComparison.Ordinal) ||
            value.StartsWith("data/workspace/plugins/", StringComparison.Ordinal) ||
            value.StartsWith("data/workspace/state/", StringComparison.Ordinal) ||
            value.StartsWith("data/desktop/", StringComparison.Ordinal);
    }

    static void CopyRange(string srcPath, long offset, long length, string destPath)
    {
        using (FileStream src = new FileStream(srcPath, FileMode.Open, FileAccess.Read))
        {
            src.Seek(offset, SeekOrigin.Begin);
            using (FileStream dst = new FileStream(destPath, FileMode.Create, FileAccess.Write))
            {
                byte[] buf = new byte[1048576];
                long remain = length;
                while (remain > 0)
                {
                    int want = (int)Math.Min((long)buf.Length, remain);
                    int got = src.Read(buf, 0, want);
                    if (got <= 0) break;
                    dst.Write(buf, 0, got);
                    remain -= got;
                }
            }
        }
    }

    static void WriteResource(string name, string dest)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) throw new Exception("缺少内置资源: " + name);
            using (FileStream f = new FileStream(dest, FileMode.Create, FileAccess.Write))
            {
                byte[] buf = new byte[81920];
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0) f.Write(buf, 0, n);
            }
        }
    }

    static void CreateShortcut(string target, string workdir)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(desktop, "WeChatGirl.lnk") });
        lnk.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
        lnk.GetType().InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workdir });
        string icon = Path.Combine(Path.GetDirectoryName(target), "resources", "app", "icon.ico");
        if (File.Exists(icon)) lnk.GetType().InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon });
        lnk.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
        string oldShortcut = Path.Combine(desktop, "WeChatAgent.lnk");
        if (File.Exists(oldShortcut)) File.Delete(oldShortcut);
    }

    static void RemoveLegacyUninstallEntry(string installDir)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(LegacyUninstallKey, false))
            {
                if (key == null) return;
                string location = key.GetValue("InstallLocation") as string;
                string uninstall = (key.GetValue("UninstallString") as string ?? "").Trim().Trim('"');
                bool sameInstall = !string.IsNullOrEmpty(location) &&
                    string.Equals(Path.GetFullPath(location).TrimEnd('\\'), Path.GetFullPath(installDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
                if (!sameInstall && !string.IsNullOrEmpty(uninstall))
                    sameInstall = uninstall.StartsWith(Path.GetFullPath(installDir).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
                if (sameInstall) Registry.CurrentUser.DeleteSubKeyTree(LegacyUninstallKey, false);
            }
        }
        catch { }
    }

    static void CleanupLegacyFiles(string installDir)
    {
        string appDir = Path.Combine(installDir, "app");
        foreach (string name in new[] { "Uninstall WeChatAgent.exe", "uninstallerIcon.ico" })
        {
            try
            {
                string path = Path.Combine(appDir, name);
                if (File.Exists(path)) File.Delete(path);
            }
            catch { }
        }

        string oldExe = Path.Combine(appDir, "WeChatAgent.exe");
        if (!File.Exists(oldExe)) return;
        try
        {
            foreach (Process process in Process.GetProcessesByName("WeChatAgent"))
            {
                try
                {
                    if (string.Equals(process.MainModule.FileName, oldExe, StringComparison.OrdinalIgnoreCase)) return;
                }
                catch { return; }
            }
            File.Delete(oldExe);
        }
        catch { }
    }
}
