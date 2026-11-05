const DAY=86400000;
export function eventDate(text,now=Date.now()){
 const local=new Date(now+8*3600000),today=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
 const explicit=text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/);let date;
 if(explicit){date=Date.UTC(+explicit[1],+explicit[2]-1,+explicit[3]);const check=new Date(date);if(check.getUTCFullYear()!==+explicit[1]||check.getUTCMonth()!==+explicit[2]-1||check.getUTCDate()!==+explicit[3])throw Error('EVENT_DATE_INVALID');}
 else if(/后天/.test(text))date=today+2*DAY;else if(/明天/.test(text))date=today+DAY;else if(/今天/.test(text))date=today;
 else{const week=text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);if(week){const day='日一二三四五六'.indexOf(week[2]==='天'?'日':week[2]),current=local.getUTCDay();let offset=((day+6)%7)-((current+6)%7);if(week[1]==='下周')offset+=7;else if(!['本周','这周'].includes(week[1])&&offset<0)offset+=7;date=today+offset*DAY;}}
 const digits={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};const number=value=>/^\d+$/.test(value)?Number(value):value.includes('十')?(digits[value.split('十')[0]]??1)*10+(digits[value.split('十')[1]]??0):digits[value];
 const clock=text.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})(?::(\d{1,2})|点(?:(半|一刻|三刻)|(\d{1,2}|[零一二三四五六七八九十]{1,3})分?)?)/);let time;
 if(clock){let hour=number(clock[2]),minute=clock[3]?+clock[3]:clock[4]?({'半':30,'一刻':15,'三刻':45}[clock[4]]):clock[5]?number(clock[5]):0;if(['下午','晚上','中午'].includes(clock[1])&&hour<12)hour+=12;if(clock[1]==='凌晨'&&hour===12)hour=0;if(!Number.isInteger(hour)||hour>23||hour<0||!Number.isInteger(minute)||minute<0||minute>59)throw Error('EVENT_TIME_INVALID');time=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');}
 if(date===undefined&&!time)return null;const day=date===undefined?null:new Date(date).toISOString().slice(0,10);return {date:day,...(time?{time,...(day?{at:day+'T'+time+':00+08:00'}:{})}:{}),timezone:'Asia/Shanghai',precision:day?(time?'minute':'day'):'time',source:text.slice(0,300)};
}
export function participants(person,people,ids,text){const selected=[person.id,...(ids??[])];return [...new Set(selected)].map(id=>{const p=people.find(row=>row.id===id);if(!p)throw Error('EVENT_PARTICIPANT_NOT_PRESENT');if(id!==person.id&&(!p.name||people.filter(row=>row.name===p.name).length!==1||!text.includes(p.name)))throw Error('EVENT_PARTICIPANT_NOT_CONFIRMED');return {id:p.id,name:p.name??''};});}
export function expiry(state,settings,now){return now+(state==='planned'?(settings.plannedRetentionDays??30):(settings.closedRetentionDays??7))*DAY;}
