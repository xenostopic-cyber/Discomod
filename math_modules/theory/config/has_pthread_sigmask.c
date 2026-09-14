#include <stdlib.h>
#include <signal.h>
#include <pthread.h>

static __thread long counter;

void *start_routine(void *pt_val)
{
  long val = *(long *)pt_val;
  counter = val+1;
  return NULL;
}

int main(void)
{
  pthread_t thread;
  counter = 0;
  sigset_t set, oldset;
  sigfillset(&set);
  pthread_sigmask(SIG_SETMASK, &set, &oldset);
  if (pthread_create(&thread, NULL, start_routine, &counter))
    exit(1);
  pthread_sigmask(SIG_SETMASK, &oldset, NULL);
  if (pthread_join(thread, NULL))
    exit(1);
  return 0;
}
