-- One database per bounded context. Names match the service directories.
CREATE DATABASE identity_tenancy;
CREATE DATABASE network;
CREATE DATABASE address;
CREATE DATABASE orders_consignments;
CREATE DATABASE execution;
CREATE DATABASE planning;
CREATE DATABASE promise;
CREATE DATABASE exceptions;
CREATE DATABASE money;
CREATE DATABASE policy;
CREATE DATABASE connectors;

-- Isolated databases for the test suites. Each suite owns one, so files running in parallel
-- never clobber each other's tables.
CREATE DATABASE test_runtime;
CREATE DATABASE test_eventstore;
CREATE DATABASE test_consumer;
CREATE DATABASE test_contracts;
CREATE DATABASE test_network;
CREATE DATABASE test_orders;
CREATE DATABASE test_execution;
CREATE DATABASE test_identity;
CREATE DATABASE test_address;
CREATE DATABASE test_exceptions;
