/* Copyright (C) 2002  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

/* Original code contributed by: Ralf Stephan (ralf@ark.in-berlin.de).
 * Updated by Bill Allombert (2014) to use Selberg formula for L
 * following http://dx.doi.org/10.1112/S1461157012001088
 *
 * This program is a variant of the basic script

   Psi(n, q) = my(b = n-1/24, a = sqrt(2/3)*Pi*sqrt(b) / q); \
               (a*cosh(a)-sinh(a)) / ((2*b)^(3/2)*Pi);
   L(n,q)=sum(l=0,2*q-1, \
              if(((3*l^2+l)/2+n)%q==0,(-1)^l*cos((6*l+1)/(6*q)*Pi)))
   part(n) = round(sum(q=1,5 + 0.24*sqrt(n), q*L(n,q)*Psi(n,q)) / sqrt(3));

 * Requires high precision exponentials which fail if
 *   log2( exp(sqrt(2*n/3)*Pi) ) > LGBITS * BITS_IN_LONG
 * so around n ~ 2^54 on a 32-bit machine. Impose n < 2^54 since the
 * computation is in O~(n) anyway. This also ensures that 6(0.24 sqrt(n) + 5)
 * fits in an ulong */

#include "pari.h"
#include "paripriv.h"

/****************************************************************/

/* Given c = Pi/6*sqrt(24*n-1)
 * Psi(n, q) = my(a = c/q); a*cosh(a) - sinh(a) */
static GEN
psi(GEN c, ulong q)
{
  GEN a = divru(c, q), ea = mpexp(a), invea = invr(ea);
  GEN cha = shiftr(addrr(ea, invea), -1); /* ch(a) */
  GEN sha = shiftr(subrr(ea, invea), -1); /* sh(a) */
  return subrr(mulrr(a,cha), sha);
}

/* n > 0, T[1] = x, T[i] = x^i or NULL return x^n and update T according to
 * the naive addition chain for n. Yao's algorithm would save a few
 * multiplications (e.g., if we have 2 and 4 we can build 6 directy instead of
 * caching 3 first) */
static GEN
gpow_cache(ulong n, GEN T)
{
  GEN y = gel(T,n);
  if (y) return y;
  if (odd(n))
    y = gmul(gel(T,1), gpow_cache(n - 1, T));
  else
    y = gsqr(gpow_cache(n >> 1, T));
  gel(T,n) = y; return y;
}

/* L(n,q)=sum(l=0,2*q-1, \
              if(((3*l^2+l)/2+n)%q==0,(-1)^l*cos((6*l+1)/(6*q)*Pi)))
 * Not called with q < 3, so ignore this case
 * Because n < 2^54 and q < 0.24*sqrt(n)+5, 12*q+1 fits into a 32-bit ulong */
static GEN
SelbergL(GEN n, ulong q, long bitprec)
{
  ulong l, lastl = 0, r = 2, m = umodiu(n,q), L = odd(q)? q: 2*q;
  GEN s = NULL, v6 = NULL, zlast = NULL;

  for (l = 0; l < L; l++)
  { /* r = 2 + 3l mod q, m = n + (3l^2 + l)/2 mod q*/
    if (m == 0)
    {
      GEN c;
      if (!v6)
      {
        long prec = nbits2prec(bitprec / q + q);
        zlast = rootsof1u_cx(12*q, prec);
        v6 = const_vec(L, NULL); /* v6[l] = z^(6l) = e(l/2q) */
        gel(v6,1) = gpowgs(zlast, 6);
      }
      if (l) zlast = gmul(zlast, gpow_cache(l - lastl, v6));
      /* zlast = e((1 + 6l)/(12q)), t_COMPLEX of t_REALs */
      c = gel(zlast, 1); /* cos(Pi*(6*l+1)/(6*q)) as a t_REAL */
      if (!s)
        s = odd(l)? negr(c): c;
      else
        s = odd(l)? subrr(s, c): addrr(s, c);
      lastl = l;
    }
    m += r; if (m >= q) m -= q;
    r += 3; if (r >= q) r -= q;
  }
  if (!s) return NULL;
  /* if q odd, l and l+q contribute the same, so we halved the range */
  return odd(q)? gmul2n(s,1): s;
}

/* estimate of log2 p(n) ~ log2(exp(Pi sqrt(2n/3)) / 4n sqrt(3)) */
static double
log2pn(GEN n)
{
  pari_sp av = avma;
  GEN z, pi = mppi(DEFAULTPREC);
  z = divru(itor(shifti(n,1), DEFAULTPREC), 3);
  z = mpexp(mulrr(pi, sqrtr(z))); /* exp(Pi * sqrt(2n/3)) */
  z = divrr(z, mulir(shifti(n,2), sqrtr(utor(3,DEFAULTPREC))));
  return gc_double(av, dbllog2(z));
}

/* b = n-1/24; c = Pi*sqrt(2*b/3) = Pi*sqrt((24*n-1)) / 6;
 * d = sqrt(3)*(2*b)^(3/2) * Pi = 6*b*c = (24*n-1) * c / 4 */
static void
pinit(GEN n, GEN *c, GEN *d, ulong prec)
{
  GEN m = subiu(muliu(n,24), 1), Pi = mppi(prec);
  *c = divru(mulrr(Pi, sqrtr(itor(m, prec))), 6);
  *d = mulir(m, *c); shiftr_inplace(*d, -2);
}

/* part(n) = round(sum(q=1,5 + 0.24*sqrt(n), L(n,q)*Psi(n,q))) */
GEN
numbpart(GEN n)
{
  pari_sp ltop = avma, av;
  GEN sum, C, D, s1, s2;
  long prec, bitprec;
  ulong q;

  if (typ(n) != t_INT) pari_err_TYPE("partition function",n);
  if (signe(n) < 0) return gen_0;
  if (abscmpiu(n, 2) < 0) return gen_1;
  if (expi(n) > 53) pari_err_OVERFLOW("numbpart [n < 2^54]");
  bitprec = (long)log2pn(n) + 32; /* ~ log2 p(n) + 32 */
  prec = nbits2prec(bitprec);
  pinit(n, &C, &D, prec);
  sum = utor(0, prec); av = avma;
  for (q = (ulong)(sqrt(gtodouble(n))*0.24 + 5); q >= 3; q--)
  {
    GEN L = SelbergL(n, q, bitprec);
    if (L)
    {
      GEN P = psi(gprec_w(C, nbits2prec(bitprec / q + 32)), q);
      affrr(addrr(sum, mulru(mulrr(L, P), q)), sum); set_avma(av);
    }
  }
  /* L(n,1) = sqrt(3) */
  s1 = mulrr(psi(C, 1), sqrtr_abs(utor(3, prec)));
  /* 2 * L(n,2) = (-1)^n * sqrt(6) */
  s2 = mulrr(psi(C, 2), sqrtr_abs(utor(6, prec)));
  if (mpodd(n)) togglesign(s2);
  return gc_INT(ltop, roundr(divrr(addrr(addrr(sum, s2), s1), D)));
}

/* for loop over partitions of integer k.
 * nbounds can restrict partitions to have length between nmin and nmax
 * (the length is the number of non zero entries) and
 * abounds restrict to integers between amin and amax.
 *
 * Start from central partition.
 * By default, remove zero entries on the left.
 *
 * Algorithm:
 *
 * A partition of k is an increasing sequence v1,... vn with sum(vi)=k
 * The starting point is the minimal n-partition of k: a,...a,a+1,.. a+1
 * (a+1 is repeated r times with k = a * n + r).
 *
 * The procedure to obtain the next partition:
 * - find the last index i<n such that v{i-1} != v{i} (that is vi is the start
 * of the last constant range excluding vn).
 * - decrease vi by one, and set v{i+1},... v{n} to be a minimal partition (of
 * the right sum).
 *
 * Examples: we highlight the index i
 * 1 1 2 2 3
 *     ^
 * 1 1 1 3 3
 *       ^
 * 1 1 1 2 4
 *       ^
 * 1 1 1 1 5
 * ^
 * 0 2 2 2 3
 *   ^
 * This is recursive in nature. Restrictions on upper bounds of the vi or on
 * the length of the partitions are straightforward to take into account. */

static void
parse_interval(GEN a, long *amin, long *amax)
{
  switch (typ(a))
  {
  case t_INT:
    *amax = itos(a);
    break;
  case t_VEC:
    if (lg(a) != 3)
      pari_err_TYPE("forpart [expect vector of type [amin,amax]]",a);
    *amin = gtos(gel(a,1));
    *amax = gtos(gel(a,2));
    if (*amin>*amax || *amin<0 || *amax<=0)
      pari_err_TYPE("forpart [expect 0<=min<=max, 0<max]",a);
    break;
  default:
    pari_err_TYPE("forpart",a);
  }
}

void
forpart_init(forpart_t *T, long k, GEN abound, GEN nbound)
{

  /* bound on coefficients */
  T->amin=1;
  if (abound) parse_interval(abound,&T->amin,&T->amax);
  else T->amax = k;
  /* strip leading zeros ? */
  T->strip = (T->amin > 0) ? 1 : 0;
  /* bound on number of nonzero coefficients */
  T->nmin=0;
  if (nbound) parse_interval(nbound,&T->nmin,&T->nmax);
  else T->nmax = k;

  /* non empty if nmin*amin <= k <= amax*nmax */
  if ( T->amin*T->nmin > k || k > T->amax * T->nmax )
  {
    T->nmin = T->nmax = 0;
  }
  else
  {
    /* to reach nmin one must have k <= nmin*amax, otherwise increase nmin */
    if ( T->nmin * T->amax < k )
      T->nmin = 1 + (k - 1) / T->amax; /* ceil( k/tmax ) */
    /* decrease nmax (if strip): k <= amin*nmax */
    if (T->strip && T->nmax > k/T->amin)
      T->nmax = k / T->amin; /* strip implies amin>0 */ /* fixme: take ceil( ) */
    /* no need to change amin */
    /* decrease amax if amax + (nmin-1)*amin > k  */
    if ( T->amax + (T->nmin-1)* T->amin > k )
      T->amax = k - (T->nmin-1)* T->amin;
  }

  if ( T->amax < T->amin )
    T->nmin = T->nmax = 0;

  T->v = zero_zv(T->nmax); /* partitions will be of length <= nmax */
  T->k = k;
}

GEN
forpart_next(forpart_t *T)
{
  GEN v = T->v;
  long n = lg(v)-1;
  long i, s, a, k, vi, vn;

  if (n>0 && v[n])
  {
    /* find index to increase: i s.t. v[i+1],...v[n] is central a,..a,a+1,..a+1
       keep s = v[i] + v[i+1] + ... + v[n] */
    s = a = v[n];
    for(i = n-1; i>0 && v[i]+1 >= a; s += v[i--]);
    if (i == 0) {
      /* v is central [ a, a, .. a, a+1, .. a+1 ] */
      if ((n+1) * T->amin > s || n == T->nmax) return NULL;
      i = 1; n++;
      setlg(v, n+1);
      vi = T->amin;
    } else {
      s += v[i];
      vi = v[i]+1;
    }
  } else {
    /* init v */
    s = T->k;
    if (T->amin == 0) T->amin = 1;
    if (T->strip) { n = T->nmin; setlg(T->v, n+1); }
    if (s==0)
    {
      if (n==0 && T->nmin==0) {T->nmin++; return v;}
      return NULL;
    }
    if (n==0) return NULL;
    vi = T->amin;
    i = T->strip ? 1 : n + 1 - T->nmin; /* first nonzero index */
    if (s <= (n-i)*vi) return NULL;
  }
  /* now fill [ v[i],... v[n] ] with s, start at vi */
  vn = s - (n-i)*vi; /* expected value for v[n] */
  if (T->amax && vn > T->amax)
  {
    /* do not exceed amax */
    long ai, q, r;
    vn -= vi;
    ai = T->amax - vi;
    q = vn / ai; /* number of nmax */
    r = vn % ai; /* value before nmax */
    /* fill [ v[i],... v[n] ] as [ vi,... vi, vi+r, amax,... amax ] */
    while ( q-- ) v[n--] = T->amax;
    if ( n >= i ) v[n--] = vi + r;
    while ( n >= i ) v[n--] = vi;
  } else {
    /* fill as [ v[i], ... v[i], vn ] */
    for ( k=i; k<n; v[k++] = vi );
    v[n] = vn;
  }
  return v;
}

GEN
forpart_prev(forpart_t *T)
{
  GEN v = T->v;
  long n = lg(v)-1;
  long j, ni, q, r;
  long i, s;
  if (n>0 && v[n])
  {
    /* find index to decrease: start of last constant sequence, excluding v[n] */
    i = n-1; s = v[n];
    while (i>1 && (v[i-1]==v[i] || v[i+1]==T->amax))
      s+= v[i--];
    if (!i) return NULL;
    /* amax condition: cannot decrease i if maximal on the right */
    if ( v[i+1] == T->amax ) return NULL;
    /* amin condition: stop if below except if strip & try to remove */
    if (v[i] == T->amin) {
      if (!T->strip) return NULL;
      s += v[i]; v[i] = 0;
    } else {
      v[i]--; s++;
    }
    /* zero case... */
    if (v[i] == 0)
    {
      if (T->nmin > n-i) return NULL; /* need too many non zero coeffs */
      /* reduce size of v ? */
      if (T->strip) {
        i = 0; n--;
        setlg(v, n+1);
      }
    }
  } else
  {
    s = T->k;
    i = 0;
    if (s==0)
    {
      if (n==0 && T->nmin==0) {T->nmin++; return v;}
      return NULL;
    }
    if (n*T->amax < s || s < T->nmin*T->amin) return NULL;
  }
  /* set minimal partition of sum s starting from index i+1 */
  ni = n-i;
  q = s / ni;
  r = s % ni;
  for(j=i+1;   j<=n-r; j++) v[j]=q;
  for(j=n-r+1; j<=n;   j++) v[j]=q + 1;
  return v;
}

static long
countpart(long k, GEN abound, GEN nbound)
{
  pari_sp av = avma;
  long n;
  forpart_t T;
  if (k<0) return 0;
  forpart_init(&T, k, abound, nbound);
  for (n=0; forpart_next(&T); n++)
  set_avma(av);
  return n;
}

GEN
partitions(long k, GEN abound, GEN nbound)
{
  GEN v;
  forpart_t T;
  long i, n = countpart(k,abound,nbound);
  if (n==0) return cgetg(1, t_VEC);
  forpart_init(&T, k, abound, nbound);
  v = cgetg(n+1, t_VEC);
  for (i=1; i<=n; i++)
    gel(v,i)=zv_copy(forpart_next(&T));
  return v;
}

void
forpart(void *E, long call(void*, GEN), long k, GEN abound, GEN nbound)
{
  pari_sp av = avma;
  GEN v;
  forpart_t T;
  forpart_init(&T, k, abound, nbound);
  while ((v=forpart_next(&T)))
    if (call(E, v)) break;
  set_avma(av);
}

void
forpart0(GEN k, GEN code, GEN abound, GEN nbound)
{
  pari_sp av = avma;
  if (typ(k) != t_INT) pari_err_TYPE("forpart",k);
  if (signe(k)<0) return;
  push_lex(gen_0, code);
  forpart((void*)code, &gp_evalvoid, itos(k), abound, nbound);
  pop_lex(1);
  set_avma(av);
}
