// Supabase(クラウドのデータベース)の接続先
// ・どちらも Supabase の管理画面からコピーして貼り付ける(手順は CLAUDE.md の「手順5」)
// ・ここに入れるのは「公開用キー(publishable key、sb_publishable_ で始まる)」だけ。
//   画面側に置く前提のキーで、データはログインと RLS(行単位のアクセス制限)で守られている。
// ・「秘密のキー(secret key、sb_secret_ で始まる)」は絶対にここに入れない。
// ・両方とも空のときは、これまでどおり この端末の中だけに保存する。

export const SUPABASE_URL = '';
export const SUPABASE_PUBLISHABLE_KEY = '';
