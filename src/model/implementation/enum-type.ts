import { GraphQLEnumType, GraphQLScalarType } from 'graphql';
import { TypeBase } from './type-base';
import { EnumTypeConfig, TypeKind } from '../config';

export class EnumType extends TypeBase {
    constructor(input: EnumTypeConfig) {
        super(input);
        this.values = input.values;
    }

    readonly values: ReadonlyArray<string>;

    readonly isObjectType: false = false;
    readonly kind: TypeKind.ENUM = TypeKind.ENUM;
    readonly isChildEntityType: false = false;
    readonly isRootEntityType: false = false;
    readonly isEntityExtensionType: false = false;
    readonly isValueObjectType: false = false;
    readonly isScalarType: false = false;
    readonly isEnumType: true = true;
}