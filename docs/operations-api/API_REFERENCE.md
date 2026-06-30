# UPL / Operations API Reference

- **Title:** UPL Admin API  
- **Base URL:** `https://backend.energize-logistics.com`  
- **Auth:** every request needs header `x-api-key: <key>`; protected endpoints also need `Authorization: Bearer <JWT>` (get JWT from `POST /api/v1/admins/login`).  
- **Response envelope:** `{ statusCode, message, data }`. Lists return `data: { items: [...], meta: { totalItems, currentPage, totalPages, hasNextPage, hasPreviousPage, limit } }`.


## Admins

### `POST /api/v1/admins`
Create a new admin

**Body** (`multipart/form-data`):

- image: `string`
- active: `string` enum=['true', 'false']
- **password** (required): `string`
- branches: `array`
- **name** (required): `string`
- **email** (required): `string`
- **phone** (required): `string`
- national_id: `string`
- device_token: `string`
- device_serial_num: `string`
- version_number: `string`
- address: `string`
- zip_code: `number`
- verified: `number` enum=[True, False]
- city_id: `string`
- country_id: `string`
- **roles** (required): `array`

### `GET /api/v1/admins`
Get all admins

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `verified` (enum: ['true', 'false']), `city_id`, `country_id`, `role`, `role_group`

### `DELETE /api/v1/admins`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admins/{id}`
### `PATCH /api/v1/admins/{id}`
**Body** (`multipart/form-data`):

- image: `string`
- active: `string` enum=['true', 'false']
- password: `string`
- branches: `array`
- name: `string`
- email: `string`
- phone: `string`
- national_id: `string`
- device_token: `string`
- device_serial_num: `string`
- version_number: `string`
- address: `string`
- zip_code: `number`
- verified: `number` enum=[True, False]
- city_id: `string`
- country_id: `string`
- roles: `array`

### `DELETE /api/v1/admins/{id}`
### `PATCH /api/v1/admins/restore/{id}`
### `PATCH /api/v1/admins/assign-branches/{id}`
Assigns branches to a admin by his id

**Body** (`application/json`):

- **branches** (required): `array`


## Admins Authentication

### `POST /api/v1/admins/login`
login as a admin

**Body** (`application/json`):

- email: `string`
- phone: `string`
- device_serial_num: `string`
- **password** (required): `string`

### `POST /api/v1/admins/logout`
Log out and remove the http-only tokens

### `POST /api/v1/admins/logout-mobile`
Log out and remove the device token of the notification

### `POST /api/v1/admins/refresh-token`
Generate new access token

### `POST /api/v1/admins/forgot-password`
Send the email to get the forgot password otp code

**Body** (`application/json`):

- email: `string`
- phone: `string`

### `POST /api/v1/admins/verify-otp`
Send the email along with the otp to verify the otp code

**Body** (`application/json`):

- email: `string`
- phone: `string`
- **otp** (required): `number`

### `POST /api/v1/admins/reset-password`
Send the email along with the new passwords to reset the password

**Body** (`application/json`):

- email: `string`
- phone: `string`
- **password** (required): `string`
- **confirmPassword** (required): `string`
- **resetPasswordToken** (required): `string`

### `POST /api/v1/admins/resend-otp`
Send the email to resend the otp

**Body** (`application/json`):

- email: `string`
- phone: `string`


## Admins Profile

### `GET /api/v1/admins/profile`
### `PATCH /api/v1/admins/profile`
**Body** (`multipart/form-data`):

- image: `string`
- password: `string`
- branches: `array`
- name: `string`
- national_id: `string`
- device_token: `string`
- version_number: `string`
- address: `string`
- zip_code: `number`
- city_id: `string`
- country_id: `string`

### `GET /api/v1/admins/operation-app-home`
Fetches the mobile app operation admin home page, including profile, notifications count, and each shipment status count


## Branches

### `POST /api/v1/admin/branches`
Create a new branch

**Body** (`application/json`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **country_id** (required): `string`
- **city_id** (required): `string`

### `GET /api/v1/admin/branches`
Get all branches

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `country_id`, `city_id`

### `DELETE /api/v1/admin/branches`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/branches/{id}`
### `PATCH /api/v1/admin/branches/{id}`
**Body** (`application/json`):

- name: `?`
- active: `string` enum=['true', 'false']
- country_id: `string`
- city_id: `string`

### `DELETE /api/v1/admin/branches/{id}`
### `PATCH /api/v1/admin/branches/restore/{id}`

## Business User City Representatives

### `POST /api/v1/admin/business-user-city-representatives`
Create a new business user representative for a business user in a city

**Body** (`application/json`):

- **user_id** (required): `string`
- **city_id** (required): `string`
- **representative_name** (required): `string`
- **representative_phone** (required): `string`
- **representative_address** (required): `string`

### `GET /api/v1/admin/business-user-city-representatives`
List all business user representatives for business users in cities

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `user_id`, `city_id`

### `DELETE /api/v1/admin/business-user-city-representatives`
Delete multiple representatives by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/business-user-city-representatives/{id}`
Fetch a business user representative by ID

### `PATCH /api/v1/admin/business-user-city-representatives/{id}`
Update a business user representative by ID

**Body** (`application/json`):

- user_id: `string`
- city_id: `string`
- representative_name: `string`
- representative_phone: `string`
- representative_address: `string`

### `DELETE /api/v1/admin/business-user-city-representatives/{id}`
Delete a representative by ID

### `PATCH /api/v1/admin/business-user-city-representatives/restore/{id}`
Restore a previously deleted representative by ID


## Business User Info

### `POST /api/v1/admin/business-user-info`
Create a new business user info

**Body** (`multipart/form-data`):

- **owner_name** (required): `string`
- **owner_phone** (required): `string`
- **manager_name** (required): `string`
- **manager_phone** (required): `string`
- **accountant_name** (required): `string`
- **accountant_phone** (required): `string`
- **commercial_register** (required): `string`
- **tax_card** (required): `string`
- **national_address** (required): `string`
- **bank_name** (required): `string`
- **iban** (required): `string`
- **contract_file** (required): `string`
- **payment_terms** (required): `string`
- **user_id** (required): `string`

### `GET /api/v1/admin/business-user-info`
Get all business user info

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `user_id`

### `DELETE /api/v1/admin/business-user-info`
Delete multiple business user info

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/business-user-info/{id}`
Fetch a business user info by id

### `PATCH /api/v1/admin/business-user-info/{id}`
Update a business user info by id

**Body** (`multipart/form-data`):

- owner_name: `string`
- owner_phone: `string`
- manager_name: `string`
- manager_phone: `string`
- accountant_name: `string`
- accountant_phone: `string`
- commercial_register: `string`
- tax_card: `string`
- national_address: `string`
- bank_name: `string`
- iban: `string`
- contract_file: `string`
- payment_terms: `string`
- user_id: `string`

### `DELETE /api/v1/admin/business-user-info/{id}`
### `PATCH /api/v1/admin/business-user-info/restore/{id}`

## Car Owner City Representatives

### `POST /api/v1/admin/car-owner-city-representatives`
Create a new representative for a car owner in a city

**Body** (`application/json`):

- **car_owner_id** (required): `string`
- **city_id** (required): `string`
- **representative_name** (required): `string`
- **representative_phone** (required): `string`
- **representative_address** (required): `string`
- work_locations: `object`
- active: `boolean`

### `GET /api/v1/admin/car-owner-city-representatives`
List all representatives for car owners in cities

**Query params:** `active` (enum: ['true', 'false']), `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `car_owner_id`, `city_id`

### `DELETE /api/v1/admin/car-owner-city-representatives`
Delete multiple representatives by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/car-owner-city-representatives/{id}`
Fetch a representative by ID

### `PATCH /api/v1/admin/car-owner-city-representatives/{id}`
Update a representative by ID

**Body** (`application/json`):

- car_owner_id: `string`
- city_id: `string`
- representative_name: `string`
- representative_phone: `string`
- representative_address: `string`
- work_locations: `object`
- active: `boolean`

### `DELETE /api/v1/admin/car-owner-city-representatives/{id}`
Delete a representative by ID

### `PATCH /api/v1/admin/car-owner-city-representatives/restore/{id}`
Restore a previously deleted representative by ID


## Car brands

### `POST /api/v1/admin/car-brands`
Create a new car brand

**Body** (`multipart/form-data`):

- **name** (required): `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `GET /api/v1/admin/car-brands`
Get all car brand

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/car-brands`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/car-brands/{id}`
### `PATCH /api/v1/admin/car-brands/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `DELETE /api/v1/admin/car-brands/{id}`
### `PATCH /api/v1/admin/car-brands/restore/{id}`

## Car colors

### `POST /api/v1/admin/car-colors`
Create a new car color

**Body** (`application/json`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **color_code** (required): `string`

### `GET /api/v1/admin/car-colors`
Get all car colors

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/car-colors`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/car-colors/{id}`
### `PATCH /api/v1/admin/car-colors/{id}`
**Body** (`application/json`):

- name: `?`
- active: `string` enum=['true', 'false']
- color_code: `string`

### `DELETE /api/v1/admin/car-colors/{id}`
### `PATCH /api/v1/admin/car-colors/restore/{id}`

## Car owners

### `POST /api/v1/admin/car-owners`
Create a new car owner

**Body** (`multipart/form-data`):

- car_owner_number: `string`
- commercial_register: `string`
- tax_card: `string`
- national_address: `string`
- bank_name: `string`
- iban: `string`
- owner_name: `string`
- owner_phone: `string`
- manager_name: `string`
- manager_phone: `string`
- accountant_name: `string`
- accountant_phone: `string`
- **contract_file** (required): `string`
- **payment_terms** (required): `string`
- **agreed_price_statement** (required): `string`
- **owner_id** (required): `string`
- **delegate_id** (required): `string`

### `GET /api/v1/admin/car-owners`
Get all car owners

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`

### `DELETE /api/v1/admin/car-owners`
Deletes multiple car owners by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/car-owners/{id}`
### `PATCH /api/v1/admin/car-owners/{id}`
Updates a car owner by its id

**Body** (`multipart/form-data`):

- car_owner_number: `string`
- commercial_register: `string`
- tax_card: `string`
- national_address: `string`
- bank_name: `string`
- iban: `string`
- owner_name: `string`
- owner_phone: `string`
- manager_name: `string`
- manager_phone: `string`
- accountant_name: `string`
- accountant_phone: `string`
- contract_file: `string`
- payment_terms: `string`
- agreed_price_statement: `string`
- owner_id: `string`
- delegate_id: `string`

### `DELETE /api/v1/admin/car-owners/{id}`
Deletes a car owner by its id

### `PATCH /api/v1/admin/car-owners/restore/{id}`
Restores a car owner by its id


## Cars

### `POST /api/v1/admin/cars`
Create a new car

**Body** (`multipart/form-data`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **car_number** (required): `string`
- **car_model_year** (required): `number`
- car_record_number: `string`
- **plate_number** (required): `string`
- **vehicle_registration_image** (required): `string`
- insurance_details: `string`
- operation_card_number: `string`
- operation_card_expiry: `string`
- **truck_type_id** (required): `string`
- **country_id** (required): `string`
- **car_brand_id** (required): `string`
- **car_color_id** (required): `string`
- **owner_id** (required): `string`

### `GET /api/v1/admin/cars`
Get all cars

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `owner_id`

### `DELETE /api/v1/admin/cars`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/cars/{id}`
### `PATCH /api/v1/admin/cars/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- active: `string` enum=['true', 'false']
- car_number: `string`
- car_model_year: `number`
- car_record_number: `string`
- plate_number: `string`
- vehicle_registration_image: `string`
- insurance_details: `string`
- operation_card_number: `string`
- operation_card_expiry: `string`
- truck_type_id: `string`
- country_id: `string`
- car_brand_id: `string`
- car_color_id: `string`
- owner_id: `string`

### `DELETE /api/v1/admin/cars/{id}`
### `PATCH /api/v1/admin/cars/restore/{id}`

## Chats

### `POST /api/v1/admin/chats`
Create a new chat

**Body** (`application/json`):

- **user_id** (required): `string`

### `GET /api/v1/admin/chats`
Get all chats

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`

### `DELETE /api/v1/admin/chats`
Deletes multiple chats by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `PATCH /api/v1/admin/chats/{id}`
Updates a chat by its id

**Body** (`application/json`):

- **allow_to_send** (required): `number` enum=[True, False]

### `DELETE /api/v1/admin/chats/{id}`
Deletes a chat by its id

### `PATCH /api/v1/admin/chats/restore/{id}`
Restores a chat by its id


## Cities

### `POST /api/v1/admin/cities`
Create a new city

**Body** (`application/json`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **country_id** (required): `string`
- lat: `number`
- lng: `number`

### `GET /api/v1/admin/cities`
Get all cities

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `country_id`

### `DELETE /api/v1/admin/cities`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/cities/{id}`
### `PATCH /api/v1/admin/cities/{id}`
**Body** (`application/json`):

- name: `?`
- active: `string` enum=['true', 'false']
- country_id: `string`
- lat: `number`
- lng: `number`

### `DELETE /api/v1/admin/cities/{id}`
### `PATCH /api/v1/admin/cities/restore/{id}`

## Countries

### `POST /api/v1/admin/countries`
Create a new country

**Body** (`multipart/form-data`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **flag** (required): `string`

### `GET /api/v1/admin/countries`
Get all countries

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/countries`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/countries/{id}`
### `PATCH /api/v1/admin/countries/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- active: `string` enum=['true', 'false']
- flag: `string`

### `DELETE /api/v1/admin/countries/{id}`
### `PATCH /api/v1/admin/countries/restore/{id}`

## Drivers

### `POST /api/v1/admin/drivers`
Create a new driver

**Body** (`multipart/form-data`):

- **name** (required): `string`
- **phone** (required): `string`
- password: `string`
- email: `string`
- **nationality** (required): `string`
- residence_number: `string`
- **residence_image** (required): `string`
- **license_image** (required): `string`
- **absher_image** (required): `string`
- **driver_card_number** (required): `string`
- driver_card_expiry: `string`
- company_name: `string`
- sponsor_name: `string`
- **car_owner_id** (required): `string`
- **car_id** (required): `string`

### `GET /api/v1/admin/drivers`
Get all drivers

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`

### `DELETE /api/v1/admin/drivers`
Delete multiple drivers

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/drivers/{id}`
Get driver

### `PATCH /api/v1/admin/drivers/{id}`
Update driver

**Body** (`multipart/form-data`):

- name: `string`
- phone: `string`
- password: `string`
- email: `string`
- nationality: `string`
- residence_number: `string`
- residence_image: `string`
- license_image: `string`
- absher_image: `string`
- driver_card_number: `string`
- driver_card_expiry: `string`
- company_name: `string`
- sponsor_name: `string`
- car_owner_id: `string`
- car_id: `string`

### `DELETE /api/v1/admin/drivers/{id}`
Delete driver

### `PATCH /api/v1/admin/drivers/restore/{id}`

## General Reports

### `GET /api/v1/admin/reports/stats`
Get all shipments Reports Statistics

**Query params:** `date_from`, `date_to`, `branches`

### `GET /api/v1/admin/reports/charts-maps-tables`
Get all shipments Reports Charts, Maps and Tables

**Query params:** `date_from`, `date_to`, `branches`


## General settings

### `POST /api/v1/admin/general-settings`
Create a new general setting

**Body** (`multipart/form-data`):

- **name** (required): `?`
- **description** (required): `?`
- image: `string`
- active: `string` enum=['true', 'false']
- **type** (required): `string` enum=['intro_screen', 'static_page', 'setting']
- **order_number** (required): `number`
- **key** (required): `string`

### `GET /api/v1/admin/general-settings`
Get all general settings

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `type` (enum: ['intro_screen', 'static_page', 'setting']), `key`

### `DELETE /api/v1/admin/general-settings`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/general-settings/{key}`
### `PATCH /api/v1/admin/general-settings/{key}`
**Body** (`multipart/form-data`):

- name: `?`
- description: `?`
- image: `string`
- active: `string` enum=['true', 'false']
- order_number: `number`

### `DELETE /api/v1/admin/general-settings/{key}`
### `PATCH /api/v1/admin/general-settings/restore/{key}`

## Generate, Import, and Export Excel

### `GET /api/v1/admin/download-excel`
Download empty excel file to be filled with data then import it

**Query params:** `model` (enum: ['car_brands', 'car_colors', 'load_types', 'branches', 'truck_types', 'truck_sizes', 'car_owners', 'cars', 'drivers', 'shipments'])

### `POST /api/v1/admin/import-excel`
Import excel file data

**Body** (`multipart/form-data`):

- **model** (required): `string` enum=['car_brands', 'car_colors', 'load_types', 'branches', 'truck_types', 'truck_sizes', 'car_owners', 'cars', 'drivers', 'shipments']
- **file** (required): `string`

### `POST /api/v1/admin/export-excel`
Export data in excel file

**Body** (`application/json`):

- **model** (required): `string` enum=['car_brands', 'car_colors', 'load_types', 'branches', 'truck_types', 'truck_sizes', 'car_owners', 'cars', 'drivers', 'shipments']
- **columns** (required): `array`
- **translations** (required): `array`
- filters: `object`


## Import Logs

### `GET /api/v1/admin/import-log`
Get all import logs

**Query params:** `isPaginated` (enum: ['true', 'false']), `limit`, `page`

### `GET /api/v1/admin/import-log/{id}`

## Input types

### `GET /api/v1/admin/input-types`
Get all input types

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`


## Load Types

### `POST /api/v1/admin/load-types`
Create a new load type

**Body** (`multipart/form-data`):

- **name** (required): `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `GET /api/v1/admin/load-types`
Get all load type

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/load-types`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/load-types/{id}`
### `PATCH /api/v1/admin/load-types/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `DELETE /api/v1/admin/load-types/{id}`
### `PATCH /api/v1/admin/load-types/restore/{id}`

## Messages

### `POST /api/v1/admin/messages`
Create a new message

**Body** (`multipart/form-data`):

- image: `string`
- chat_id: `string`
- message: `string`
- voice: `string`
- **user_id** (required): `string`

### `DELETE /api/v1/admin/messages`
Deletes multiple messages by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/messages/{id}`
### `PATCH /api/v1/admin/messages/{id}`
Updates a message by its id

**Body** (`application/json`):

- **read** (required): `number` enum=[True, False]

### `DELETE /api/v1/admin/messages/{id}`
Deletes a message by its id

### `PATCH /api/v1/admin/messages/restore/{id}`
Restores a message by its id


## Notifications

### `POST /api/v1/admin/notifications/many`
Create many notification

**Body** (`application/json`):

- **name** (required): `?`
- **description** (required): `?`
- user_ids: `array`
- admin_ids: `array`
- payload: `?`

### `POST /api/v1/admin/notifications`
Create a new notification

**Body** (`application/json`):

- **name** (required): `?`
- **description** (required): `?`
- user_id: `string`
- admin_id: `string`
- payload: `?`

### `GET /api/v1/admin/notifications`
Get all notifications

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `read` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/notifications`
Deletes multiple notifications by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/notifications/me`
Get my notifications

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `read` (enum: ['true', 'false'])

### `GET /api/v1/admin/notifications/{id}`
### `DELETE /api/v1/admin/notifications/{id}`
Deletes a notification by its id

### `PATCH /api/v1/admin/notifications/read/{id}`
Marks a notification as read

### `PATCH /api/v1/admin/notifications/restore/{id}`
Restores a notification by its id


## Permissions

### `GET /api/v1/permissions`
Get all permissions

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `type` (enum: ['mobile', 'web'])

### `GET /api/v1/permissions/{id}`
### `PATCH /api/v1/permissions/{id}`
**Body** (`application/json`):

- name: `?`
- description: `?`
- type: `string` enum=['mobile', 'web']


## Roles

### `POST /api/v1/roles`
Create a new role

**Body** (`application/json`):

- **key** (required): `string`
- **name** (required): `?`
- description: `?`
- **group** (required): `string` enum=['super_admin', 'web_admin', 'operation', 'driver', 'delegate', 'car_owner']
- **permissions** (required): `array`

### `GET /api/v1/roles`
Get all roles

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`

### `DELETE /api/v1/roles`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/roles/{id}`
### `PATCH /api/v1/roles/{id}`
**Body** (`application/json`):

- name: `?`
- description: `?`
- group: `string` enum=['super_admin', 'web_admin', 'operation', 'driver', 'delegate', 'car_owner']
- permissions: `array`

### `DELETE /api/v1/roles/{id}`
### `PATCH /api/v1/roles/restore/{id}`

## Shipment Form Additional Inputs

### `POST /api/v1/admin/additional-inputs`
Create a new additional input

**Body** (`application/json`):

- **name** (required): `?`
- active: `string` enum=['true', 'false']
- **required** (required): `number` enum=[True, False]
- target_entity: `?`
- value: `string`
- **input_type_id** (required): `string`

### `GET /api/v1/admin/additional-inputs`
Get all additional inputs

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `required` (enum: [True, False])

### `DELETE /api/v1/admin/additional-inputs`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/additional-inputs/{id}`
### `PATCH /api/v1/admin/additional-inputs/{id}`
**Body** (`application/json`):

- name: `?`
- active: `string` enum=['true', 'false']
- required: `number` enum=[True, False]
- target_entity: `?`
- value: `string`
- input_type_id: `string`

### `DELETE /api/v1/admin/additional-inputs/{id}`
### `PATCH /api/v1/admin/additional-inputs/restore/{id}`

## Shipment Reports

### `POST /api/v1/admin/shipment-reports`
Create a new shipment report

**Body** (`application/json`):

- active: `string` enum=['true', 'false']
- **name** (required): `string`
- **columns** (required): `array`
- **filters** (required): `object`

### `GET /api/v1/admin/shipment-reports`
Get all shipment reports

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/shipment-reports`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/shipment-reports/generate/{id}`
Generates a shipment report

### `GET /api/v1/admin/shipment-reports/{id}`
Fetches a shipment report

### `PATCH /api/v1/admin/shipment-reports/{id}`
Updates a shipment report by its id

**Body** (`application/json`):

- active: `string` enum=['true', 'false']
- name: `string`
- columns: `array`
- filters: `object`

### `DELETE /api/v1/admin/shipment-reports/{id}`
### `PATCH /api/v1/admin/shipment-reports/restore/{id}`

## Shipments

### `POST /api/v1/admin/shipments`
Create a new shipment

**Body** (`multipart/form-data`):

- **payment_method** (required): `string` enum=['cash', 'late']
- start_area_id: `string`
- **address_from** (required): `string`
- lat_from: `number`
- lng_from: `number`
- reach_area_id: `string`
- **address_to** (required): `string`
- lat_to: `number`
- lng_to: `number`
- **qty** (required): `number`
- goods_value_price: `number`
- **pick_time** (required): `string`
- **truck_type_id** (required): `string`
- **load_type_id** (required): `string`
- **truck_size_id** (required): `string`
- additional_inputs: `array`
- status: `string` enum=['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled']
- reference_num: `string`
- **user_id** (required): `string`
- starting_time: `string`
- access_time: `string`
- selling_price: `number`
- purchase_price: `number`
- notes: `string`
- advance: `number`
- bond_sent_image: `string`
- driver_rental_price: `number`
- driver_rental_type: `string` enum=['back', 'front']
- **driver_id** (required): `string`
- **car_id** (required): `string`
- **delegate_id** (required): `string`
- branch_id: `string`

### `GET /api/v1/admin/shipments`
Get all shipments

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `date_from`, `date_to`, `status`, `branches`, `driver_id`, `delegate_id`, `owner_id`, `car_owner_id`, `car_id`, `car_number`, `start_area_id`, `reach_area_id`, `payment_method` (enum: ['cash', 'late']), `user_id`, `creator_type`, `driver_rental_type` (enum: ['back', 'front']), `driver_phone`, `driver_name`, `car_name`, `truck_type_name`, `truck_size_name`, `load_type_name`, `country_name`, `user_phone`, `user_name`

### `DELETE /api/v1/admin/shipments`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/shipments/without-branch`
Get all shipments without branch assigned to it

### `GET /api/v1/admin/shipments/timeline/{id}`
Fetches a shipment timeline

### `GET /api/v1/admin/shipments/pdf/{id}`
Generate shipment PDF كشف التخريج

### `POST /api/v1/admin/shipments/pdf/bulk`
Generate bulk shipment PDF كشف التخريج

**Body** (`application/json`):

- **ids** (required): `array`

### `POST /api/v1/admin/shipments/share-pdf-via-whatsapp`
Share single or many shipment PDF كشف التخريج via whatsapp

**Body** (`application/json`):

- **ids** (required): `array`
- **phone_numbers** (required): `array`

### `GET /api/v1/admin/shipments/reports`
Get shipments Reports/Charts for operation mobile app

**Query params:** `date_from`, `date_to`

### `GET /api/v1/admin/shipments/{id}`
### `PATCH /api/v1/admin/shipments/{id}`
Updates a shipment by its id

**Body** (`multipart/form-data`):

- payment_method: `string` enum=['cash', 'late']
- start_area_id: `string`
- address_from: `string`
- lat_from: `number`
- lng_from: `number`
- reach_area_id: `string`
- address_to: `string`
- lat_to: `number`
- lng_to: `number`
- qty: `number`
- goods_value_price: `number`
- pick_time: `string`
- truck_type_id: `string`
- load_type_id: `string`
- truck_size_id: `string`
- additional_inputs: `array`
- status: `string` enum=['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled']
- reference_num: `string`
- user_id: `string`
- starting_time: `string`
- access_time: `string`
- selling_price: `number`
- purchase_price: `number`
- notes: `string`
- advance: `number`
- bond_sent_image: `string`
- driver_rental_price: `number`
- driver_rental_type: `string` enum=['back', 'front']
- driver_id: `string`
- car_id: `string`
- delegate_id: `string`
- branch_id: `string`
- status_log_details: `string`

### `DELETE /api/v1/admin/shipments/{id}`
### `PATCH /api/v1/admin/shipments/status`
Updates many shipments by their ids

**Body** (`application/json`):

- **status** (required): `string` enum=['requesting', 'loading', 'uploaded', 'on_way', 'arrived', 'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled']
- **ids** (required): `array`
- status_log_details: `string`

### `PATCH /api/v1/admin/shipments/restore/{id}`
### `POST /api/v1/admin/shipments/city`
Get city from lat lng or link

**Body** (`application/json`):

- lat: `number`
- lng: `number`
- link: `string`

### `POST /api/v1/admin/shipments/{id}/clone`
Clones an existing shipment the provided number of times

**Body** (`application/json`):

- **count** (required): `number`


## Truck Sizes

### `POST /api/v1/admin/truck-sizes`
Create a new truckSize

**Body** (`multipart/form-data`):

- **name** (required): `?`
- image: `string`
- active: `string` enum=['true', 'false']
- **truck_type_id** (required): `string`

### `GET /api/v1/admin/truck-sizes`
Get all truckSizes

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `truck_type_id`

### `DELETE /api/v1/admin/truck-sizes`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/truck-sizes/{id}`
### `PATCH /api/v1/admin/truck-sizes/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- image: `string`
- active: `string` enum=['true', 'false']
- truck_type_id: `string`

### `DELETE /api/v1/admin/truck-sizes/{id}`
### `PATCH /api/v1/admin/truck-sizes/restore/{id}`

## Truck Types

### `POST /api/v1/admin/truck-types`
Create a new truckType

**Body** (`multipart/form-data`):

- **name** (required): `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `GET /api/v1/admin/truck-types`
Get all truckTypes

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false'])

### `DELETE /api/v1/admin/truck-types`
**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/truck-types/{id}`
### `PATCH /api/v1/admin/truck-types/{id}`
**Body** (`multipart/form-data`):

- name: `?`
- image: `string`
- active: `string` enum=['true', 'false']

### `DELETE /api/v1/admin/truck-types/{id}`
### `PATCH /api/v1/admin/truck-types/restore/{id}`

## Users

### `POST /api/v1/admin/users`
Create a new user

**Body** (`application/json`):

- active: `string` enum=['true', 'false']
- verified: `string` enum=['true', 'false']
- name: `string`
- email: `string`
- **phone** (required): `string`
- **user_type** (required): `?`
- address: `string`
- zip_code: `number`
- device_token: `string`
- city_id: `string`

### `GET /api/v1/admin/users`
Get all users

**Query params:** `isLocalized` (enum: ['true', 'false']), `sort`, `search`, `isPaginated` (enum: ['true', 'false']), `limit`, `page`, `active` (enum: ['true', 'false']), `verified` (enum: ['true', 'false']), `user_type`, `city_id`

### `DELETE /api/v1/admin/users`
Deletes multiple users by their IDs

**Body** (`application/json`):

- **ids** (required): `array`

### `GET /api/v1/admin/users/{id}`
Fetches a user by his id

### `PATCH /api/v1/admin/users/{id}`
Updates a user by his id

**Body** (`application/json`):

- active: `string` enum=['true', 'false']
- verified: `string` enum=['true', 'false']
- name: `string`
- email: `string`
- phone: `string`
- user_type: `?`
- address: `string`
- zip_code: `number`
- device_token: `string`
- city_id: `string`

### `DELETE /api/v1/admin/users/{id}`
Deletes a user by his id

### `PATCH /api/v1/admin/users/restore/{id}`
Restores a user by his id

