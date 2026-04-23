import { redirect } from 'next/navigation';

// "/" 접속 시 실제 앱인 /fima.html 로 이동
export default function Page() {
  redirect('/fima.html');
}
