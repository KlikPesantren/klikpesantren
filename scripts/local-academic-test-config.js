// Local disposable fixtures only. Never infer a target from DATABASE_URL/.env.
function localAcademicTestConfig(env=process.env) {
  const host=env.AK_TEST_DB_HOST,port=Number(env.AK_TEST_DB_PORT||55433),user=env.AK_TEST_DB_USER;
  const database=env.AK_TEST_DB_NAME||'klikpesantren_ak_test';
  if(!['127.0.0.1','localhost'].includes(host)||![55433,55439].includes(port)||!user||
    !/^klikpesantren_ak(?:_[a-z0-9]+)*_test$/.test(database)) {
    throw Error('Refusing non-loopback or non-disposable AK database');
  }
  return {host,port,user,password:env.AK_TEST_DB_PASSWORD||'',database};
}
module.exports={localAcademicTestConfig};
