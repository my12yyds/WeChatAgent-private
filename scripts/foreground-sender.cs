// Independent foreground text sender. Uses Windows UI Automation only.
using System;
using System.Linq;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Forms;

public static class WhaleForeground {
  public static bool Attempted=false;
  static Random random=new Random();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  static AutomationElement Find(AutomationElement root, string id) {
    return root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,id));
  }
  static AutomationElement Window(string exe) {
    exe=System.IO.Path.GetFullPath(exe);
    var candidates=Process.GetProcesses().Where(p=>{try{return p.MainWindowHandle!=IntPtr.Zero&&String.Equals(p.MainModule.FileName,exe,StringComparison.OrdinalIgnoreCase);}catch{return false;}}).ToArray();
    if(candidates.Length!=1)throw new Exception("FOREGROUND_WINDOW_AMBIGUOUS");
    return AutomationElement.FromHandle(candidates[0].MainWindowHandle);
  }
  static bool Click(AutomationElement e) {
    object pattern;
    if(e.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){((InvokePattern)pattern).Invoke();return true;}
    if(e.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern)){((SelectionItemPattern)pattern).Select();return true;}
    System.Windows.Point point;
    if(e.TryGetClickablePoint(out point)){
      SetCursorPos((int)point.X,(int)point.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);return true;
    }
    return false;
  }
  static void Fill(AutomationElement e,string text) {
    object value;
    if(!e.TryGetCurrentPattern(ValuePattern.Pattern,out value))throw new Exception("FOREGROUND_VALUE_UNAVAILABLE");
    ((ValuePattern)value).SetValue(text);
  }
  public static bool Probe(string exe) {
    var root=Window(exe);
    var input=Find(root,"chat_input_field");
    var search=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"搜索"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));
    object value;
    return (input!=null&&input.TryGetCurrentPattern(ValuePattern.Pattern,out value)) || (search!=null&&search.TryGetCurrentPattern(ValuePattern.Pattern,out value));
  }
  static AutomationElement OpenChat(string exe,string name) {
    var root=Window(exe);var handle=new IntPtr(root.Current.NativeWindowHandle);
    SetForegroundWindow(handle);Thread.Sleep(100);
    if(GetForegroundWindow()!=handle)throw new Exception("FOREGROUND_FOCUS_REQUIRED");
    var input=Find(root,"chat_input_field");
    if(input==null||input.Current.Name!=name){
      var search=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"搜索"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));
      if(search==null)throw new Exception("FOREGROUND_SEARCH_UNAVAILABLE");
      Fill(search,name);Thread.Sleep(600);
      var list=Find(root,"search_list");
      if(list==null)throw new Exception("FOREGROUND_SEARCH_EMPTY");
      var results=list.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>()
        .Where(e=>e.Current.AutomationId.StartsWith("search_item_")&&e.Current.Name.Split('\n')[0].Trim()==name).ToArray();
      if(results.Length!=1||!Click(results[0]))throw new Exception("FOREGROUND_TARGET_AMBIGUOUS");
      Thread.Sleep(250);input=Find(root,"chat_input_field");
    }
    if(input==null||input.Current.Name!=name||GetForegroundWindow()!=handle)throw new Exception("FOREGROUND_TARGET_CHANGED");
    return root;
  }
  static AutomationElement EmptyInput(AutomationElement root,string name){
    var input=Find(root,"chat_input_field");
    if(input==null||input.Current.Name!=name)throw new Exception("FOREGROUND_TARGET_CHANGED");
    object pattern;
    // Never overwrite a user's unsent draft.
    if(!input.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)||!String.IsNullOrEmpty(((ValuePattern)pattern).Current.Value))throw new Exception("FOREGROUND_DRAFT_PRESENT");
    return input;
  }
  public static bool Send(string exe,string name,string text) {
    var root=OpenChat(exe,name);var handle=new IntPtr(root.Current.NativeWindowHandle);var input=EmptyInput(root,name);
    input.SetFocus();Fill(input,text);
    if(input.Current.Name!=name||GetForegroundWindow()!=handle||!input.Current.HasKeyboardFocus)throw new Exception("FOREGROUND_FOCUS_CHANGED");
    Attempted=true;SendKeys.SendWait("{ENTER}");
    return true; // Submission only. The parent confirms using the message database.
  }
  static bool Visible(AutomationElement e){var r=e.Current.BoundingRectangle;return !e.Current.IsOffscreen&&!r.IsEmpty&&r.Width>=16&&r.Height>=16;}
  static AutomationElement[] Controls(AutomationElement root){return root.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>().ToArray();}
  static AutomationElement Panel(AutomationElement root){
    var panel=Controls(root).FirstOrDefault(e=>Visible(e)&&(e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpanel"||e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpopover"));
    if(panel!=null)return panel;
    return AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition).Cast<AutomationElement>().FirstOrDefault(e=>e.Current.ProcessId==root.Current.ProcessId&&Visible(e)&&(e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpanel"||e.Current.ClassName.ToLowerInvariant()=="mmui::emoticonpopover"));
  }
  static AutomationElement[] Favorites(AutomationElement panel,bool generic){return Controls(panel).Where(e=>{
    var cls=e.Current.ClassName.ToLowerInvariant();var r=e.Current.BoundingRectangle;
    return Visible(e)&&r.Width<=320&&r.Height<=320&&(cls=="mmui::favemoticonitemview"||e.Current.AutomationId.ToLowerInvariant().Contains("favemoticon")||generic&&(cls=="mmui::emoticonitemview"||cls=="mmui::commonemoticonview"));
  }).ToArray();}
  public static bool SendFavorite(string exe,string name){
    var root=OpenChat(exe,name);EmptyInput(root,name);
    var launcher=Controls(root).FirstOrDefault(e=>Visible(e)&&(e.Current.AutomationId=="chat_text_emoticon_view"||e.Current.Name=="发送表情"||e.Current.Name=="表情"||e.Current.ClassName=="mmui::EmoticonView"));
    var panel=Panel(root);
    if(panel==null){if(launcher==null||!Click(launcher))throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");Thread.Sleep(400);panel=Panel(root);}
    if(panel==null)throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");
    var items=Favorites(panel,false);
    if(items.Length==0){
      var tab=Controls(panel).FirstOrDefault(e=>Visible(e)&&e.Current.ClassName.ToLowerInvariant()=="mmui::emoticontoolbaritem"&&(e.Current.Name.Contains("收藏")||e.Current.Name.Contains("自定义表情")||(e.Current.AutomationId+e.Current.Name).ToLowerInvariant().Contains("fav")));
      if(tab==null||!Click(tab))throw new Exception("FOREGROUND_FAVORITES_TAB_UNAVAILABLE");
      Thread.Sleep(300);panel=Panel(root);if(panel==null)throw new Exception("FOREGROUND_STICKER_PANEL_UNAVAILABLE");items=Favorites(panel,true);
    }
    if(items.Length==0)throw new Exception("FOREGROUND_FAVORITES_EMPTY");
    EmptyInput(root,name);
    var foreground=AutomationElement.FromHandle(GetForegroundWindow());
    if(foreground.Current.ProcessId!=root.Current.ProcessId)throw new Exception("FOREGROUND_FOCUS_CHANGED");
    Attempted=true;if(!Click(items[random.Next(items.Length)]))throw new Exception("FOREGROUND_FAVORITE_NOT_CLICKED");
    return true;
  }
}
