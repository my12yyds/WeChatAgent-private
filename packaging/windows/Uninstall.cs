using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

class Uninstall
{
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WeChatGirl";
    const string LegacyUninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WeChatAgent";

    static int Main(string[] args)
    {
        try
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            Console.WriteLine("============================================");
            Console.WriteLine("  WeChatGirl 卸载程序");
            Console.WriteLine("  安装位置: " + dir);
            Console.WriteLine("============================================");
            Console.WriteLine();

            Console.WriteLine("正在停止 WeChatGirl 进程...");
            try
            {
                foreach (string processName in new[] { "WeChatGirl", "WeChatAgent" })
                foreach (Process p in Process.GetProcessesByName(processName))
                {
                    try
                    {
                        string executable = p.MainModule.FileName;
                        if (executable.StartsWith(Path.Combine(dir, "app") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        { p.Kill(); p.WaitForExit(5000); }
                    }
                    catch { }
                }
            }
            catch { }

            Console.WriteLine("正在删除桌面快捷方式...");
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                foreach (string shortcut in new[] { "WeChatGirl.lnk", "WeChatAgent.lnk" })
                {
                    string lnk = Path.Combine(desktop, shortcut);
                    if (File.Exists(lnk)) File.Delete(lnk);
                }
            }
            catch { }

            Console.WriteLine("正在清理注册表...");
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            RemoveLegacyUninstallEntry(dir);

            Console.WriteLine("正在移除程序文件；账号配置、人设与聊天数据会保留...");
            string appDir = Path.Combine(dir, "app");
            if (Directory.Exists(appDir))
            {
                string storageMarker = Path.Combine(appDir, "storage.ini");
                foreach (string file in Directory.GetFiles(appDir, "*", SearchOption.AllDirectories))
                    if (!string.Equals(file, storageMarker, StringComparison.OrdinalIgnoreCase)) File.Delete(file);
                string[] dirs = Directory.GetDirectories(appDir, "*", SearchOption.AllDirectories);
                Array.Sort(dirs, (a, b) => b.Length.CompareTo(a.Length));
                foreach (string subdir in dirs) { try { Directory.Delete(subdir, false); } catch { } }
            }
            string script = Path.Combine(Path.GetTempPath(), "wechatgirl-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
            string body =
                "@echo off\r\n" +
                "ping -n 2 127.0.0.1 >nul\r\n" +
                "rmdir \"" + Path.Combine(dir, "app") + "\"\r\n" +
                "del /f /q \"" + script + "\"\r\n";
            File.WriteAllText(script, body, System.Text.Encoding.Default);
            Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"")
            {
                WindowStyle = ProcessWindowStyle.Hidden,
                CreateNoWindow = true,
                UseShellExecute = false
            });

            Console.WriteLine("卸载完成，文件将在几秒内删除。");
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("卸载失败: " + ex.Message);
            Console.WriteLine("按任意键退出...");
            try { Console.ReadKey(); } catch { }
            return 1;
        }
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
}
