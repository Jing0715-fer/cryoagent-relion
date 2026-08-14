// Minimal MPI stub for building RELION without real MPI.
// All MPI functions are no-ops returning success.
#ifndef MPI_STUB_H
#define MPI_STUB_H
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// MPI types (stubs)
typedef int MPI_Comm;
typedef int MPI_Request;
typedef struct { int MPI_TAG; int MPI_SOURCE; int MPI_ERROR; } MPI_Status;
typedef int MPI_Datatype;
typedef int MPI_Op;
typedef int MPI_Group;
typedef int MPI_Info;
typedef long MPI_Aint;
typedef int MPI_Errhandler;

#define MPI_COMM_WORLD 0
#define MPI_COMM_NULL -1
#define MPI_STATUS_IGNORE NULL
#define MPI_STATUSES_IGNORE NULL
#define MPI_REQUEST_NULL NULL

// MPI datatypes (stubs — just use int values)
#define MPI_CHAR 1
#define MPI_SHORT 2
#define MPI_INT 3
#define MPI_LONG 4
#define MPI_UNSIGNED_CHAR 5
#define MPI_UNSIGNED_SHORT 6
#define MPI_UNSIGNED 7
#define MPI_UNSIGNED_LONG 8
#define MPI_FLOAT 9
#define MPI_DOUBLE 10
#define MPI_LONG_DOUBLE 11
#define MPI_BYTE 12
#define MPI_PACKED 13
#define MPI_LONG_LONG_INT 14
#define MPI_LONG_LONG 14
#define MPI_UNSIGNED_LONG_LONG 15
#define MPI_C_DOUBLE_COMPLEX 16
#define MPI_CXX_DOUBLE_COMPLEX 16
#define MPI_COMPLEX 17
#define MPI_DOUBLE_COMPLEX 18
#define MPI_2DOUBLE 19
#define MPI_2INT 20
#define MPI_SHORT_INT 21
#define MPI_LONG_INT 22
#define MPI_FLOAT_INT 23
#define MPI_DOUBLE_INT 24

// MPI ops
#define MPI_MAX 0
#define MPI_MIN 1
#define MPI_SUM 2
#define MPI_PROD 3
#define MPI_LAND 4
#define MPI_BAND 5
#define MPI_LOR 6
#define MPI_BOR 7
#define MPI_LXOR 8
#define MPI_BXOR 9
#define MPI_MAXLOC 10
#define MPI_MINLOC 11

// Constants
#define MPI_SUCCESS 0
#define MPI_ANY_SOURCE -1
#define MPI_ANY_TAG -1
#define MPI_TAG_UB 0
#define MPI_ERRORS_RETURN 0
#define MPI_ERRORS_ARE_FATAL 1

// MPI functions — all no-ops
static inline int MPI_Init(int *argc, char ***argv) { (void)argc; (void)argv; return 0; }
static inline int MPI_Init_thread(int *argc, char ***argv, int required, int *provided) { (void)argc; (void)argv; (void)required; *provided = 0; return 0; }
static inline int MPI_Finalize(void) { return 0; }
static inline int MPI_Comm_rank(MPI_Comm comm, int *rank) { (void)comm; *rank = 0; return 0; }
static inline int MPI_Comm_size(MPI_Comm comm, int *size) { (void)comm; *size = 1; return 0; }
static inline int MPI_Comm_split(MPI_Comm comm, int color, int key, MPI_Comm *newcomm) { (void)comm; (void)color; (void)key; *newcomm = 0; return 0; }
static inline int MPI_Comm_free(MPI_Comm *comm) { *comm = -1; return 0; }
static inline int MPI_Comm_dup(MPI_Comm comm, MPI_Comm *newcomm) { *newcomm = comm; return 0; }
static inline int MPI_Comm_group(MPI_Comm comm, MPI_Group *group) { (void)comm; *group = 0; return 0; }
static inline int MPI_Group_incl(MPI_Group group, int n, int *ranks, MPI_Group *newgroup) { (void)group; (void)n; (void)ranks; *newgroup = 0; return 0; }
static inline int MPI_Comm_create(MPI_Comm comm, MPI_Group group, MPI_Comm *newcomm) { (void)comm; (void)group; *newcomm = 0; return 0; }
static inline int MPI_Group_free(MPI_Group *group) { *group = -1; return 0; }
static inline int MPI_Barrier(MPI_Comm comm) { (void)comm; return 0; }
static inline int MPI_Bcast(void *buf, int count, MPI_Datatype datatype, int root, MPI_Comm comm) { (void)buf; (void)count; (void)datatype; (void)root; (void)comm; return 0; }
static inline int MPI_Reduce(void *sendbuf, void *recvbuf, int count, MPI_Datatype datatype, MPI_Op op, int root, MPI_Comm comm) { (void)sendbuf; (void)recvbuf; (void)count; (void)datatype; (void)op; (void)root; (void)comm; return 0; }
static inline int MPI_Allreduce(void *sendbuf, void *recvbuf, int count, MPI_Datatype datatype, MPI_Op op, MPI_Comm comm) { (void)sendbuf; (void)recvbuf; (void)count; (void)datatype; (void)op; (void)comm; return 0; }
static inline int MPI_Gather(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int recvcount, MPI_Datatype recvtype, int root, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcount; (void)recvtype; (void)root; (void)comm; return 0; }
static inline int MPI_Scatter(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int recvcount, MPI_Datatype recvtype, int root, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcount; (void)recvtype; (void)root; (void)comm; return 0; }
static inline int MPI_Send(void *buf, int count, MPI_Datatype datatype, int dest, int tag, MPI_Comm comm) { (void)buf; (void)count; (void)datatype; (void)dest; (void)tag; (void)comm; return 0; }
static inline int MPI_Recv(void *buf, int count, MPI_Datatype datatype, int source, int tag, MPI_Comm comm, MPI_Status *status) { (void)buf; (void)count; (void)datatype; (void)source; (void)tag; (void)comm; (void)status; return 0; }
static inline int MPI_Isend(void *buf, int count, MPI_Datatype datatype, int dest, int tag, MPI_Comm comm, MPI_Request *request) { (void)buf; (void)count; (void)datatype; (void)dest; (void)tag; (void)comm; *request = 0; return 0; }
static inline int MPI_Irecv(void *buf, int count, MPI_Datatype datatype, int source, int tag, MPI_Comm comm, MPI_Request *request) { (void)buf; (void)count; (void)datatype; (void)source; (void)tag; (void)comm; *request = 0; return 0; }
static inline int MPI_Wait(MPI_Request *request, MPI_Status *status) { (void)request; (void)status; return 0; }
static inline int MPI_Waitall(int count, MPI_Request *array_of_requests, MPI_Status *array_of_statuses) { (void)count; (void)array_of_requests; (void)array_of_statuses; return 0; }
static inline int MPI_Waitany(int count, MPI_Request *array_of_requests, int *index, MPI_Status *status) { (void)count; (void)array_of_requests; *index = 0; (void)status; return 0; }
static inline int MPI_Test(MPI_Request *request, int *flag, MPI_Status *status) { (void)request; *flag = 1; (void)status; return 0; }
static inline int MPI_Testall(int count, MPI_Request *array_of_requests, int *flag, MPI_Status *array_of_statuses) { (void)count; (void)array_of_requests; *flag = 1; (void)array_of_statuses; return 0; }
static inline int MPI_Request_free(MPI_Request *request) { *request = -1; return 0; }
static inline int MPI_Abort(MPI_Comm comm, int errorcode) { (void)comm; exit(errorcode); return 0; }
static inline int MPI_Error_string(int errorcode, char *string, int *resultlen) { (void)errorcode; strcpy(string, "unknown error"); *resultlen = strlen(string); return 0; }
static inline double MPI_Wtime(void) { return 0.0; }
static inline int MPI_Get_processor_name(char *name, int *resultlen) { strcpy(name, "localhost"); *resultlen = strlen(name); return 0; }
static inline int MPI_Get_count(MPI_Status *status, MPI_Datatype datatype, int *count) { (void)status; (void)datatype; *count = 0; return 0; }
static inline int MPI_Type_size(MPI_Datatype datatype, int *size) { (void)datatype; *size = 4; return 0; }
static inline int MPI_Pack(void *inbuf, int incount, MPI_Datatype datatype, void *outbuf, int outsize, int *position, MPI_Comm comm) { (void)inbuf; (void)incount; (void)datatype; (void)outbuf; (void)outsize; (void)position; (void)comm; return 0; }
static inline int MPI_Unpack(void *inbuf, int insize, int *position, void *outbuf, int outcount, MPI_Datatype datatype, MPI_Comm comm) { (void)inbuf; (void)insize; (void)position; (void)outbuf; (void)outcount; (void)datatype; (void)comm; return 0; }
static inline int MPI_Attr_get(MPI_Comm comm, int keyval, void *attribute_val, int *flag) { (void)comm; (void)keyval; (void)attribute_val; *flag = 0; return 0; }
static inline int MPI_Attr_put(MPI_Comm comm, int keyval, void *attribute_val) { (void)comm; (void)keyval; (void)attribute_val; return 0; }



// Additional MPI functions needed by RELION 5.0
static inline int MPI_Probe(int source, int tag, MPI_Comm comm, MPI_Status *status) { (void)source; (void)tag; (void)comm; if (status) { status->MPI_TAG = 0; status->MPI_SOURCE = 0; } return 0; }
static inline int MPI_Iprobe(int source, int tag, MPI_Comm comm, int *flag, MPI_Status *status) { (void)source; (void)tag; (void)comm; *flag = 0; if (status) { status->MPI_TAG = 0; status->MPI_SOURCE = 0; } return 0; }
static inline int MPI_Sendrecv(void *sendbuf, int sendcount, MPI_Datatype sendtype, int dest, int sendtag, void *recvbuf, int recvcount, MPI_Datatype recvtype, int source, int recvtag, MPI_Comm comm, MPI_Status *status) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)dest; (void)sendtag; (void)recvbuf; (void)recvcount; (void)recvtype; (void)source; (void)recvtag; (void)comm; (void)status; return 0; }
static inline int MPI_Allgather(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int recvcount, MPI_Datatype recvtype, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcount; (void)recvtype; (void)comm; return 0; }
static inline int MPI_Allgatherv(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int *recvcounts, int *displs, MPI_Datatype recvtype, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcounts; (void)displs; (void)recvtype; (void)comm; return 0; }
static inline int MPI_Gatherv(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int *recvcounts, int *displs, MPI_Datatype recvtype, int root, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcounts; (void)displs; (void)recvtype; (void)root; (void)comm; return 0; }
static inline int MPI_Scatterv(void *sendbuf, int *sendcounts, int *displs, MPI_Datatype sendtype, void *recvbuf, int recvcount, MPI_Datatype recvtype, int root, MPI_Comm comm) { (void)sendbuf; (void)sendcounts; (void)displs; (void)sendtype; (void)recvbuf; (void)recvcount; (void)recvtype; (void)root; (void)comm; return 0; }
static inline int MPI_Alltoall(void *sendbuf, int sendcount, MPI_Datatype sendtype, void *recvbuf, int recvcount, MPI_Datatype recvtype, MPI_Comm comm) { (void)sendbuf; (void)sendcount; (void)sendtype; (void)recvbuf; (void)recvcount; (void)recvtype; (void)comm; return 0; }
static inline int MPI_Alltoallv(void *sendbuf, int *sendcounts, int *sdispls, MPI_Datatype sendtype, void *recvbuf, int *recvcounts, int *rdispls, MPI_Datatype recvtype, MPI_Comm comm) { (void)sendbuf; (void)sendcounts; (void)sdispls; (void)sendtype; (void)recvbuf; (void)recvcounts; (void)rdispls; (void)recvtype; (void)comm; return 0; }
static inline int MPI_Bsend(void *buf, int count, MPI_Datatype datatype, int dest, int tag, MPI_Comm comm) { (void)buf; (void)count; (void)datatype; (void)dest; (void)tag; (void)comm; return 0; }
static inline int MPI_Ssend(void *buf, int count, MPI_Datatype datatype, int dest, int tag, MPI_Comm comm) { (void)buf; (void)count; (void)datatype; (void)dest; (void)tag; (void)comm; return 0; }
static inline int MPI_Rsend(void *buf, int count, MPI_Datatype datatype, int dest, int tag, MPI_Comm comm) { (void)buf; (void)count; (void)datatype; (void)dest; (void)tag; (void)comm; return 0; }
static inline int MPI_Buffer_attach(void *buffer, int size) { (void)buffer; (void)size; return 0; }
static inline int MPI_Buffer_detach(void *buffer, int *size) { (void)buffer; *size = 0; return 0; }
static inline int MPI_Type_commit(MPI_Datatype *type) { (void)type; return 0; }
static inline int MPI_Type_free(MPI_Datatype *type) { (void)type; return 0; }
static inline int MPI_Type_contiguous(int count, MPI_Datatype oldtype, MPI_Datatype *newtype) { (void)count; (void)oldtype; *newtype = 0; return 0; }
static inline int MPI_Type_struct(int count, int *array_of_blocklengths, MPI_Aint *array_of_displacements, MPI_Datatype *array_of_types, MPI_Datatype *newtype) { (void)count; (void)array_of_blocklengths; (void)array_of_displacements; (void)array_of_types; *newtype = 0; return 0; }
static inline int MPI_Op_create(void *func, int commute, MPI_Op *op) { (void)func; (void)commute; *op = 0; return 0; }
static inline int MPI_Op_free(MPI_Op *op) { (void)op; return 0; }
static inline int MPI_Comm_create_errhandler(void *function, MPI_Errhandler *errhandler) { (void)function; *errhandler = 0; return 0; }
static inline int MPI_Comm_set_errhandler(MPI_Comm comm, MPI_Errhandler errhandler) { (void)comm; (void)errhandler; return 0; }
static inline int MPI_Info_create(MPI_Info *info) { *info = 0; return 0; }
static inline int MPI_Info_free(MPI_Info *info) { (void)info; return 0; }

// More MPI constants and functions needed by RELION 5.0
#define MPI_ERR_COUNT 1
#define MPI_ERR_BUFFER 2
#define MPI_ERR_COMM 3
#define MPI_ERR_RANK 4
#define MPI_ERR_TAG 5
#define MPI_ERR_TYPE 6
#define MPI_ERR_OP 7
#define MPI_ERR_REQUEST 8
#define MPI_ERR_GROUP 9
#define MPI_ERR_DIMS 10
#define MPI_ERR_ARG 11
#define MPI_ERR_UNKNOWN 12
#define MPI_ERR_IN_STATUS 13
#define MPI_ERR_PENDING 14
#define MPI_ERR_FILE 15
#define MPI_ERR_KEYVAL 16
#define MPI_ERR_INFO 17
#define MPI_ERR_NAME 18
#define MPI_ERR_NO_MEM 19
#define MPI_ERR_SERVICE 20
#define MPI_ERR_SPAWN 21
#define MPI_ERR_INFO_KEY 22
#define MPI_ERR_INFO_VALUE 23
#define MPI_ERR_INFO_NOKEY 24
#define MPI_ERR_ROOT 25
#define MPI_ERR_TRUNCATE 26
#define MPI_ERR_OTHER 27
#define MPI_ERR_INTERN 28
#define MPI_ERR_BASE 29
#define MPI_ERR_SIZE 30
#define MPI_ERR_DISP 31
#define MPI_ERR_LOCKTYPE 32
#define MPI_ERR_WIN 33
#define MPI_ERR_RMA_CONFLICT 34
#define MPI_ERR_RMA_SYNC 35
#define MPI_ERR_RMA_RANGE 36
#define MPI_ERR_RMA_SHARED 37
#define MPI_ERR_RMA_ATTACH 38
#define MPI_ERR_RMA_FLAVOR 39
#define MPI_ERR_ASSERT 40
#define MPI_ERR_LASTCODE 41

static inline int MPI_Group_rank(MPI_Group group, int *rank) { (void)group; *rank = 0; return 0; }
static inline int MPI_Group_size(MPI_Group group, int *size) { (void)group; *size = 1; return 0; }
static inline int MPI_Group_compare(MPI_Group group1, MPI_Group group2, int *result) { (void)group1; (void)group2; *result = 0; return 0; }
static inline int MPI_Group_translate_rank(MPI_Group group1, int n, int *ranks1, MPI_Group group2, int *ranks2) { (void)group1; (void)group2; (void)n; for (int i = 0; i < n; i++) ranks2[i] = ranks1[i]; return 0; }
static inline int MPI_Group_union(MPI_Group group1, MPI_Group group2, MPI_Group *newgroup) { (void)group1; (void)group2; *newgroup = 0; return 0; }
static inline int MPI_Group_intersection(MPI_Group group1, MPI_Group group2, MPI_Group *newgroup) { (void)group1; (void)group2; *newgroup = 0; return 0; }
static inline int MPI_Group_difference(MPI_Group group1, MPI_Group group2, MPI_Group *newgroup) { (void)group1; (void)group2; *newgroup = 0; return 0; }
static inline int MPI_Group_excl(MPI_Group group, int n, int *ranks, MPI_Group *newgroup) { (void)group; (void)n; (void)ranks; *newgroup = 0; return 0; }
static inline int MPI_Group_range_incl(MPI_Group group, int n, int ranges[][3], MPI_Group *newgroup) { (void)group; (void)n; (void)ranges; *newgroup = 0; return 0; }
static inline int MPI_Group_range_excl(MPI_Group group, int n, int ranges[][3], MPI_Group *newgroup) { (void)group; (void)n; (void)ranges; *newgroup = 0; return 0; }
static inline int MPI_Error_class(int errorcode, int *errorclass) { (void)errorcode; *errorclass = 0; return 0; }
static inline int MPI_Comm_compare(MPI_Comm comm1, MPI_Comm comm2, int *result) { (void)comm1; (void)comm2; *result = 0; return 0; }
static inline int MPI_Comm_test_inter(MPI_Comm comm, int *flag) { (void)comm; *flag = 0; return 0; }
static inline int MPI_Comm_remote_size(MPI_Comm comm, int *size) { (void)comm; *size = 0; return 0; }
static inline int MPI_Comm_remote_group(MPI_Comm comm, MPI_Group *group) { (void)comm; *group = 0; return 0; }
static inline int MPI_Intercomm_create(MPI_Comm local_comm, int local_leader, MPI_Comm bridge_comm, int remote_leader, int tag, MPI_Comm *newintercomm) { (void)local_comm; (void)local_leader; (void)bridge_comm; (void)remote_leader; (void)tag; *newintercomm = 0; return 0; }
static inline int MPI_Intercomm_merge(MPI_Comm intercomm, int high, MPI_Comm *newintracomm) { (void)intercomm; (void)high; *newintracomm = 0; return 0; }
static inline int MPI_Topo_test(MPI_Comm comm, int *status) { (void)comm; *status = 0; return 0; }
static inline int MPI_Cart_create(MPI_Comm comm_old, int ndims, int *dims, int *periods, int reorder, MPI_Comm *comm_cart) { (void)comm_old; (void)ndims; (void)dims; (void)periods; (void)reorder; *comm_cart = 0; return 0; }
static inline int MPI_Cart_coords(MPI_Comm comm, int rank, int maxdims, int *coords) { (void)comm; (void)rank; (void)maxdims; *coords = 0; return 0; }
static inline int MPI_Cart_rank(MPI_Comm comm, int *coords, int *rank) { (void)comm; (void)coords; *rank = 0; return 0; }
static inline int MPI_Cart_shift(MPI_Comm comm, int direction, int disp, int *rank_source, int *rank_dest) { (void)comm; (void)direction; (void)disp; *rank_source = 0; *rank_dest = 0; return 0; }
static inline int MPI_Dims_create(int nnodes, int ndims, int *dims) { (void)nnodes; for (int i = 0; i < ndims; i++) dims[i] = 1; return 0; }
static inline int MPI_Comm_create_group(MPI_Comm comm, MPI_Group group, int tag, MPI_Comm *newcomm) { (void)comm; (void)group; (void)tag; *newcomm = 0; return 0; }


// MPI_Comm_split_type - needed by RELION 5.0
static inline int MPI_Comm_split_type(MPI_Comm comm, int split_type, int key, MPI_Info info, MPI_Comm *newcomm) { (void)comm; (void)split_type; (void)key; (void)info; *newcomm = 0; return 0; }

// MPI_COMM_TYPE_SHARED constant
#define MPI_COMM_TYPE_SHARED 0
#define MPI_COMM_SLAVES 0

#endif // MPI_STUB_H
